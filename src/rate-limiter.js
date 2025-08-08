/**
 * BIPRE Rate Limiter V3.0
 * Sistema avançado de controle de rate limit para Google Sheets API
 * Implementa Token Bucket Algorithm com Circuit Breaker
 */

class GoogleSheetsRateLimiter {
  constructor(config = {}) {
    // Configurações principais
    this.config = {
      // Limites da API
      MAX_REQUESTS_PER_MINUTE: 180,     // Google Sheets limit com margem
      MAX_REQUESTS_PER_100_SECONDS: 300, // Limite secundário
      
      // Controle de batch
      BATCH_SIZE: 25,
      MIN_INTERVAL_MS: 350,              // Mínimo entre requests
      
      // Circuit Breaker
      ERROR_THRESHOLD: 5,                // Erros para abrir circuito
      CIRCUIT_RESET_TIMEOUT: 60000,      // 1 minuto
      
      // Retry Policy
      MAX_RETRIES: 3,
      INITIAL_RETRY_DELAY: 1000,
      BACKOFF_MULTIPLIER: 2,
      MAX_RETRY_DELAY: 32000,
      
      // Monitoring
      ENABLE_METRICS: true,
      LOG_LEVEL: 'info',
      
      ...config
    };
    
    // Estado do rate limiter
    this.state = {
      tokens: this.config.MAX_REQUESTS_PER_MINUTE,
      lastRefill: Date.now(),
      requestQueue: [],
      processing: false,
      
      // Circuit breaker state
      circuitState: 'CLOSED', // CLOSED, OPEN, HALF_OPEN
      consecutiveErrors: 0,
      lastErrorTime: null,
      
      // Métricas
      metrics: {
        totalRequests: 0,
        successfulRequests: 0,
        failedRequests: 0,
        retriedRequests: 0,
        circuitBreakerTrips: 0,
        averageLatency: 0,
        requestsPerMinute: []
      }
    };
    
    // Inicia refill automático de tokens
    this.startTokenRefill();
    
    // Inicia processamento da fila
    this.startQueueProcessor();
  }
  
  /**
   * Executa request com rate limiting
   */
  async executeRequest(requestFn, metadata = {}) {
    return new Promise((resolve, reject) => {
      const request = {
        id: this.generateRequestId(),
        fn: requestFn,
        metadata,
        resolve,
        reject,
        attempts: 0,
        createdAt: Date.now()
      };
      
      // Adiciona à fila
      this.state.requestQueue.push(request);
      
      if (this.config.LOG_LEVEL === 'debug') {
        console.log(`📥 Request ${request.id} adicionado à fila. Posição: ${this.state.requestQueue.length}`);
      }
    });
  }
  
  /**
   * Processa fila de requests
   */
  async startQueueProcessor() {
    if (this.state.processing) return;
    
    this.state.processing = true;
    
    while (true) {
      try {
        // Verifica se há requests na fila
        if (this.state.requestQueue.length === 0) {
          await this.sleep(100);
          continue;
        }
        
        // Verifica circuit breaker
        if (!this.canProcess()) {
          await this.handleCircuitBreaker();
          continue;
        }
        
        // Aguarda token disponível
        await this.waitForToken();
        
        // Processa próximo request
        const request = this.state.requestQueue.shift();
        await this.processRequest(request);
        
        // Intervalo mínimo entre requests
        await this.sleep(this.config.MIN_INTERVAL_MS);
        
      } catch (error) {
        console.error('❌ Erro no processador de fila:', error);
        await this.sleep(1000);
      }
    }
  }
  
  /**
   * Processa um request individual
   */
  async processRequest(request) {
    const startTime = Date.now();
    
    try {
      // Consome token
      this.consumeToken();
      
      // Executa request
      const result = await this.executeWithRetry(request);
      
      // Atualiza métricas de sucesso
      this.updateMetrics({
        success: true,
        latency: Date.now() - startTime
      });
      
      // Resolve promise
      request.resolve(result);
      
    } catch (error) {
      // Atualiza métricas de erro
      this.updateMetrics({
        success: false,
        latency: Date.now() - startTime,
        error: error
      });
      
      // Reject promise
      request.reject(error);
    }
  }
  
  /**
   * Executa request com retry logic
   */
  async executeWithRetry(request) {
    let lastError;
    
    for (let attempt = 0; attempt <= this.config.MAX_RETRIES; attempt++) {
      try {
        request.attempts = attempt + 1;
        
        // Tenta executar
        const result = await request.fn();
        
        // Sucesso - reset erro counter
        this.state.consecutiveErrors = 0;
        
        return result;
        
      } catch (error) {
        lastError = error;
        
        // Analisa tipo de erro
        const errorType = this.analyzeError(error);
        
        if (errorType === 'RATE_LIMIT') {
          console.log(`⚠️ Rate limit detectado. Tentativa ${attempt + 1}/${this.config.MAX_RETRIES + 1}`);
          
          // Incrementa contador de erros
          this.state.consecutiveErrors++;
          
          // Calcula delay com exponential backoff
          const delay = Math.min(
            this.config.INITIAL_RETRY_DELAY * Math.pow(this.config.BACKOFF_MULTIPLIER, attempt),
            this.config.MAX_RETRY_DELAY
          );
          
          await this.sleep(delay);
          
          // Adiciona jitter para evitar thundering herd
          await this.sleep(Math.random() * 1000);
          
        } else if (errorType === 'QUOTA_EXCEEDED') {
          // Quota excedida - abre circuit breaker imediatamente
          this.openCircuitBreaker();
          throw error;
          
        } else if (errorType === 'RETRYABLE') {
          // Erro temporário - retry com delay menor
          await this.sleep(1000 * (attempt + 1));
          
        } else {
          // Erro não recuperável
          throw error;
        }
      }
    }
    
    // Esgotou tentativas
    throw new Error(`Falha após ${this.config.MAX_RETRIES + 1} tentativas: ${lastError.message}`);
  }
  
  /**
   * Analisa tipo de erro
   */
  analyzeError(error) {
    const message = error.message || error.toString();
    
    // Rate limit errors
    if (message.includes('Rate Limit') || 
        message.includes('rate limit') ||
        message.includes('429') ||
        message.includes('RATE_LIMIT_EXCEEDED')) {
      return 'RATE_LIMIT';
    }
    
    // Quota errors
    if (message.includes('Quota') ||
        message.includes('quota') ||
        message.includes('QUOTA_EXCEEDED')) {
      return 'QUOTA_EXCEEDED';
    }
    
    // Temporary errors
    if (message.includes('503') ||
        message.includes('UNAVAILABLE') ||
        message.includes('TIMEOUT')) {
      return 'RETRYABLE';
    }
    
    return 'NON_RETRYABLE';
  }
  
  /**
   * Token bucket - refill automático
   */
  startTokenRefill() {
    setInterval(() => {
      const now = Date.now();
      const timePassed = (now - this.state.lastRefill) / 1000;
      const tokensToAdd = (this.config.MAX_REQUESTS_PER_MINUTE / 60) * timePassed;
      
      this.state.tokens = Math.min(
        this.config.MAX_REQUESTS_PER_MINUTE,
        this.state.tokens + tokensToAdd
      );
      
      this.state.lastRefill = now;
      
      if (this.config.LOG_LEVEL === 'debug') {
        console.log(`🪙 Tokens disponíveis: ${Math.floor(this.state.tokens)}`);
      }
    }, 1000); // Refill a cada segundo
  }
  
  /**
   * Aguarda token disponível
   */
  async waitForToken() {
    while (this.state.tokens < 1) {
      if (this.config.LOG_LEVEL === 'debug') {
        console.log('⏳ Aguardando token disponível...');
      }
      await this.sleep(500);
    }
  }
  
  /**
   * Consome um token
   */
  consumeToken() {
    this.state.tokens = Math.max(0, this.state.tokens - 1);
    this.state.metrics.totalRequests++;
  }
  
  /**
   * Circuit Breaker - verifica se pode processar
   */
  canProcess() {
    return this.state.circuitState !== 'OPEN';
  }
  
  /**
   * Circuit Breaker - abre circuito
   */
  openCircuitBreaker() {
    if (this.state.circuitState === 'OPEN') return;
    
    console.log('🔴 Circuit Breaker ABERTO - pausando processamento');
    
    this.state.circuitState = 'OPEN';
    this.state.metrics.circuitBreakerTrips++;
    
    // Agenda reset do circuito
    setTimeout(() => {
      this.halfOpenCircuitBreaker();
    }, this.config.CIRCUIT_RESET_TIMEOUT);
  }
  
  /**
   * Circuit Breaker - meio aberto (teste)
   */
  halfOpenCircuitBreaker() {
    console.log('🟡 Circuit Breaker MEIO-ABERTO - testando...');
    this.state.circuitState = 'HALF_OPEN';
    this.state.consecutiveErrors = 0;
  }
  
  /**
   * Circuit Breaker - fecha circuito
   */
  closeCircuitBreaker() {
    if (this.state.circuitState === 'CLOSED') return;
    
    console.log('🟢 Circuit Breaker FECHADO - operação normal');
    this.state.circuitState = 'CLOSED';
    this.state.consecutiveErrors = 0;
  }
  
  /**
   * Gerencia circuit breaker
   */
  async handleCircuitBreaker() {
    if (this.state.circuitState === 'OPEN') {
      // Aguarda reset timeout
      await this.sleep(1000);
      
    } else if (this.state.circuitState === 'HALF_OPEN') {
      // Testa com um request
      if (this.state.consecutiveErrors >= 1) {
        this.openCircuitBreaker();
      } else {
        this.closeCircuitBreaker();
      }
    }
    
    // Verifica threshold de erros
    if (this.state.consecutiveErrors >= this.config.ERROR_THRESHOLD) {
      this.openCircuitBreaker();
    }
  }
  
  /**
   * Atualiza métricas
   */
  updateMetrics({ success, latency, error }) {
    const metrics = this.state.metrics;
    
    if (success) {
      metrics.successfulRequests++;
    } else {
      metrics.failedRequests++;
      
      if (error && this.analyzeError(error) === 'RATE_LIMIT') {
        metrics.retriedRequests++;
      }
    }
    
    // Atualiza latência média
    const totalRequests = metrics.successfulRequests + metrics.failedRequests;
    metrics.averageLatency = 
      (metrics.averageLatency * (totalRequests - 1) + latency) / totalRequests;
    
    // Tracking de requests por minuto
    const now = Date.now();
    metrics.requestsPerMinute = metrics.requestsPerMinute.filter(
      time => now - time < 60000
    );
    metrics.requestsPerMinute.push(now);
  }
  
  /**
   * Obtém métricas atuais
   */
  getMetrics() {
    return {
      ...this.state.metrics,
      currentQueueSize: this.state.requestQueue.length,
      availableTokens: Math.floor(this.state.tokens),
      circuitBreakerState: this.state.circuitState,
      requestsPerMinuteNow: this.state.metrics.requestsPerMinute.length
    };
  }
  
  /**
   * Reset de métricas
   */
  resetMetrics() {
    this.state.metrics = {
      totalRequests: 0,
      successfulRequests: 0,
      failedRequests: 0,
      retriedRequests: 0,
      circuitBreakerTrips: 0,
      averageLatency: 0,
      requestsPerMinute: []
    };
  }
  
  /**
   * Utility - sleep
   */
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
  
  /**
   * Gera ID único para request
   */
  generateRequestId() {
    return `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
  
  /**
   * Executa batch de requests
   */
  async executeBatch(requests) {
    console.log(`📦 Processando batch de ${requests.length} requests`);
    
    const results = [];
    const errors = [];
    
    for (const request of requests) {
      try {
        const result = await this.executeRequest(request);
        results.push(result);
      } catch (error) {
        errors.push({ request, error });
      }
    }
    
    return {
      success: results.length,
      failed: errors.length,
      results,
      errors,
      metrics: this.getMetrics()
    };
  }
}

// Singleton para uso global
let rateLimiterInstance = null;

function getRateLimiter(config) {
  if (!rateLimiterInstance) {
    rateLimiterInstance = new GoogleSheetsRateLimiter(config);
  }
  return rateLimiterInstance;
}

// Export para n8n
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { GoogleSheetsRateLimiter, getRateLimiter };
}

// Exemplo de uso no n8n
const rateLimiter = getRateLimiter({
  MAX_REQUESTS_PER_MINUTE: 180,
  BATCH_SIZE: 25,
  LOG_LEVEL: 'info'
});

// Wrap das operações do Google Sheets
const executeGoogleSheetsOperation = async (operation) => {
  return await rateLimiter.executeRequest(async () => {
    // Sua operação do Google Sheets aqui
    return operation();
  });
};

// Retorna instância para uso
return rateLimiter;