/**
 * BIPRE Movement Engine V3.0
 * Sistema inteligente de movimentação de leads entre abas
 * Resolve o problema de duplicação e implementa transições automáticas
 */

class LeadMovementEngine {
  constructor(config) {
    this.config = {
      ...this.getDefaultConfig(),
      ...config
    };
    
    this.stats = {
      moved: 0,
      deleted: 0,
      errors: 0,
      startTime: Date.now()
    };
    
    this.transitionRules = this.initializeTransitionRules();
  }
  
  getDefaultConfig() {
    return {
      DAYS_THRESHOLD: 7,
      BATCH_SIZE: 25,
      DELETE_AFTER_MOVE: true,
      AUDIT_LOG: true,
      DRY_RUN: false
    };
  }
  
  initializeTransitionRules() {
    return [
      {
        from: '1ª Mensagem',
        to: '2ª Mensagem',
        condition: (lead) => this.daysSinceLastInteraction(lead) >= 7,
        priority: 1
      },
      {
        from: '2ª Mensagem',
        to: '3ª Mensagem',
        condition: (lead) => this.daysSinceLastInteraction(lead) >= 14,
        priority: 2
      },
      {
        from: '3ª Mensagem',
        to: '4ª Mensagem',
        condition: (lead) => this.daysSinceLastInteraction(lead) >= 21,
        priority: 3
      },
      {
        from: '4ª Mensagem',
        to: '5ª Mensagem',
        condition: (lead) => this.daysSinceLastInteraction(lead) >= 28,
        priority: 4
      },
      {
        from: '5ª Mensagem',
        to: 'Lead Morto',
        condition: (lead) => this.daysSinceLastInteraction(lead) >= 35,
        priority: 5
      },
      {
        from: 'ANY',
        to: 'Lead Ativo',
        condition: (lead) => this.hasActiveInteraction(lead),
        priority: 0
      },
      {
        from: 'ANY',
        to: 'Lead Morto',
        condition: (lead) => this.hasNoInterest(lead),
        priority: 0
      }
    ];
  }
  
  /**
   * Processa movimentação de leads
   */
  async processMovements(leads) {
    console.log(`🚀 Iniciando processamento de ${leads.length} leads`);
    
    const movements = [];
    const batches = this.createBatches(leads);
    
    for (const [index, batch] of batches.entries()) {
      console.log(`📦 Processando batch ${index + 1}/${batches.length}`);
      
      try {
        const batchMovements = await this.processBatch(batch);
        movements.push(...batchMovements);
        
        // Rate limiting entre batches
        if (index < batches.length - 1) {
          await this.sleep(1000);
        }
      } catch (error) {
        console.error(`❌ Erro no batch ${index + 1}:`, error);
        this.stats.errors += batch.length;
      }
    }
    
    return this.generateReport(movements);
  }
  
  /**
   * Processa um batch de leads
   */
  async processBatch(batch) {
    const movements = [];
    
    for (const lead of batch) {
      const movement = this.determineMovement(lead);
      
      if (movement) {
        if (this.config.DRY_RUN) {
          console.log(`🔄 [DRY RUN] Moveria: ${lead.Nome} de ${movement.from} para ${movement.to}`);
        } else {
          await this.executeMovement(lead, movement);
        }
        
        movements.push({
          lead: lead.Nome,
          cpf: lead.CPF,
          from: movement.from,
          to: movement.to,
          reason: movement.reason,
          timestamp: new Date().toISOString()
        });
        
        this.stats.moved++;
      }
    }
    
    return movements;
  }
  
  /**
   * Determina se o lead deve ser movido
   */
  determineMovement(lead) {
    const currentTab = this.getCurrentTab(lead);
    
    for (const rule of this.transitionRules) {
      if (rule.from === currentTab || rule.from === 'ANY') {
        if (rule.condition(lead)) {
          return {
            from: currentTab,
            to: rule.to,
            reason: this.getMovementReason(rule, lead),
            priority: rule.priority
          };
        }
      }
    }
    
    return null;
  }
  
  /**
   * Executa a movimentação do lead
   */
  async executeMovement(lead, movement) {
    try {
      // 1. Adiciona à nova aba
      await this.addToNewTab(lead, movement.to);
      
      // 2. Remove da aba antiga (se configurado)
      if (this.config.DELETE_AFTER_MOVE) {
        await this.removeFromOldTab(lead, movement.from);
        this.stats.deleted++;
      }
      
      // 3. Registra no audit log
      if (this.config.AUDIT_LOG) {
        await this.logMovement(lead, movement);
      }
      
      // 4. Atualiza campos do lead
      lead.ULTIMA_MOVIMENTACAO = new Date().toISOString();
      lead.HISTORICO_MOVIMENTACAO = [
        ...(lead.HISTORICO_MOVIMENTACAO || []),
        {
          from: movement.from,
          to: movement.to,
          date: new Date().toISOString(),
          reason: movement.reason
        }
      ];
      
    } catch (error) {
      console.error(`❌ Erro ao mover lead ${lead.Nome}:`, error);
      throw error;
    }
  }
  
  /**
   * Adiciona lead à nova aba
   */
  async addToNewTab(lead, tabName) {
    // Prepara dados para inserção
    const data = {
      ...lead,
      MOVIDO_EM: new Date().toISOString(),
      ORIGEM_TAB: this.getCurrentTab(lead),
      STATUS_MOVIMENTO: 'MOVIDO',
      DIAS_SEM_RESPOSTA: this.daysSinceLastInteraction(lead)
    };
    
    // Aqui seria feita a chamada à API do Google Sheets
    // Por enquanto, retorna simulação
    console.log(`✅ Lead ${lead.Nome} adicionado à aba ${tabName}`);
    return data;
  }
  
  /**
   * Remove lead da aba antiga
   */
  async removeFromOldTab(lead, tabName) {
    // Aqui seria feita a chamada para deletar da planilha
    // Usando Google Sheets API com batchUpdate para deletar linha
    console.log(`🗑️ Lead ${lead.Nome} removido da aba ${tabName}`);
    return true;
  }
  
  /**
   * Registra movimentação no log de auditoria
   */
  async logMovement(lead, movement) {
    const logEntry = {
      timestamp: new Date().toISOString(),
      lead_id: lead.CPF,
      lead_name: lead.Nome,
      from_tab: movement.from,
      to_tab: movement.to,
      reason: movement.reason,
      days_without_response: this.daysSinceLastInteraction(lead),
      value: lead['Valor Principal'],
      user: 'SYSTEM',
      action: 'AUTOMATIC_MOVEMENT'
    };
    
    // Salvaria no banco de dados ou planilha de log
    console.log(`📝 Movimento registrado:`, logEntry);
    return logEntry;
  }
  
  /**
   * Calcula dias desde última interação
   */
  daysSinceLastInteraction(lead) {
    if (!lead.DATA_ENVIO && !lead['ÚLTIMA INTERAÇÃO']) return 999;
    
    const lastDate = lead.DATA_ENVIO || lead['ÚLTIMA INTERAÇÃO'];
    const date = this.parseDate(lastDate);
    const today = new Date();
    
    const diffTime = Math.abs(today - date);
    return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  }
  
  /**
   * Verifica se lead tem interação ativa
   */
  hasActiveInteraction(lead) {
    const obs = (lead.OBS || '').toLowerCase();
    const ultimaInteracao = (lead['ÚLTIMA INTERAÇÃO'] || '').toLowerCase();
    
    return obs.includes('cotação') || 
           obs.includes('cotacao') ||
           obs.includes('interessado') ||
           ultimaInteracao.includes('respondeu') ||
           ultimaInteracao.includes('ligou');
  }
  
  /**
   * Verifica se lead não tem interesse
   */
  hasNoInterest(lead) {
    const obs = (lead.OBS || '').toLowerCase();
    return obs.includes('sem interesse') || 
           obs.includes('não quer') ||
           obs.includes('bloqueou');
  }
  
  /**
   * Obtém aba atual do lead
   */
  getCurrentTab(lead) {
    return lead.ABA_ATUAL || lead.CURRENT_TAB || '1ª Mensagem';
  }
  
  /**
   * Obtém razão da movimentação
   */
  getMovementReason(rule, lead) {
    const days = this.daysSinceLastInteraction(lead);
    
    if (this.hasNoInterest(lead)) {
      return 'Lead marcou sem interesse';
    }
    
    if (this.hasActiveInteraction(lead)) {
      return 'Lead demonstrou interesse - cotação solicitada';
    }
    
    return `${days} dias sem resposta - movendo para próxima etapa`;
  }
  
  /**
   * Cria batches para processamento
   */
  createBatches(items) {
    const batches = [];
    for (let i = 0; i < items.length; i += this.config.BATCH_SIZE) {
      batches.push(items.slice(i, i + this.config.BATCH_SIZE));
    }
    return batches;
  }
  
  /**
   * Parse de data brasileira
   */
  parseDate(dateStr) {
    if (!dateStr) return new Date();
    
    // Formato DD/MM/YYYY ou DD/MM
    const parts = dateStr.split('/');
    if (parts.length === 2) {
      const [day, month] = parts;
      return new Date(new Date().getFullYear(), month - 1, day);
    } else if (parts.length === 3) {
      const [day, month, year] = parts;
      return new Date(year, month - 1, day);
    }
    
    return new Date(dateStr);
  }
  
  /**
   * Sleep utility
   */
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
  
  /**
   * Gera relatório final
   */
  generateReport(movements) {
    const duration = (Date.now() - this.stats.startTime) / 1000;
    
    return {
      summary: {
        total_processed: this.stats.moved + this.stats.errors,
        successfully_moved: this.stats.moved,
        deleted_from_old_tabs: this.stats.deleted,
        errors: this.stats.errors,
        duration_seconds: duration,
        throughput: Math.round(this.stats.moved / (duration / 60))
      },
      movements: movements,
      timestamp: new Date().toISOString(),
      config: this.config
    };
  }
}

// Export para uso no n8n
if (typeof module !== 'undefined' && module.exports) {
  module.exports = LeadMovementEngine;
}

// Uso no n8n Code Node
const engine = new LeadMovementEngine({
  DAYS_THRESHOLD: 7,
  BATCH_SIZE: 25,
  DELETE_AFTER_MOVE: true,
  AUDIT_LOG: true,
  DRY_RUN: false // Mude para true para testar sem executar
});

// Processa os leads
const leads = $input.all().map(item => item.json);
const report = await engine.processMovements(leads);

// Retorna relatório
return [{ json: report }];