/**
 * BIPRE Lead Classifier V3.0
 * Sistema avançado de classificação com IA e scoring preditivo
 */

class LeadClassifierV3 {
  constructor(config = {}) {
    this.config = {
      TIMING_DIAS: 7,
      SCORE_THRESHOLD: 70,
      USE_AI_PREDICTIONS: true,
      ...config
    };
    
    this.weights = this.initializeWeights();
    this.patterns = this.initializePatterns();
  }
  
  initializeWeights() {
    return {
      // Fatores positivos
      cotacao_solicitada: 40,
      respondeu_mensagem: 30,
      demonstrou_interesse: 25,
      valor_alto: 20,
      idade_adequada: 15,
      processo_ativo: 10,
      
      // Fatores negativos
      sem_interesse: -100,
      nao_respondeu: -20,
      bloqueou: -100,
      valor_baixo: -10,
      multiplas_tentativas: -15
    };
  }
  
  initializePatterns() {
    return {
      interesse: [
        'cotação', 'cotacao', 'interessado', 'quero', 'valor',
        'quanto', 'como funciona', 'pode explicar', 'informações'
      ],
      desinteresse: [
        'sem interesse', 'não quero', 'nao quero', 'bloqueou',
        'pare', 'sair', 'cancelar', 'não tenho', 'nao tenho'
      ],
      urgencia: [
        'urgente', 'preciso', 'rápido', 'hoje', 'agora',
        'imediato', 'prioridade'
      ],
      duvida: [
        'como', 'quando', 'onde', 'porque', 'qual',
        'dúvida', 'duvida', 'pergunta'
      ]
    };
  }
  
  /**
   * Classifica um lead completo
   */
  classifyLead(lead) {
    // Calcula scores
    const baseScore = this.calculateBaseScore(lead);
    const interactionScore = this.calculateInteractionScore(lead);
    const valueScore = this.calculateValueScore(lead);
    const timeScore = this.calculateTimeScore(lead);
    
    // Score total ponderado
    const totalScore = (
      baseScore * 0.3 +
      interactionScore * 0.4 +
      valueScore * 0.2 +
      timeScore * 0.1
    );
    
    // Determina classificação
    const classification = this.determineClassification(totalScore, lead);
    
    // Predição de conversão
    const conversionProbability = this.predictConversion(lead, totalScore);
    
    // Sugestões de ação
    const actions = this.suggestActions(classification, lead);
    
    return {
      lead_id: lead.CPF,
      lead_name: lead.Nome,
      
      // Scores
      scores: {
        base: baseScore,
        interaction: interactionScore,
        value: valueScore,
        time: timeScore,
        total: totalScore
      },
      
      // Classificação
      classification: classification,
      
      // Predições
      predictions: {
        conversion_probability: conversionProbability,
        expected_close_days: this.predictCloseDays(totalScore),
        expected_value: this.predictValue(lead, conversionProbability)
      },
      
      // Ações recomendadas
      recommended_actions: actions,
      
      // Metadados
      classified_at: new Date().toISOString(),
      classifier_version: 'V3.0'
    };
  }
  
  /**
   * Calcula score base do lead
   */
  calculateBaseScore(lead) {
    let score = 50; // Score inicial neutro
    
    const obs = (lead.OBS || '').toLowerCase();
    const ultimaInteracao = (lead['ÚLTIMA INTERAÇÃO'] || '').toLowerCase();
    
    // Analisa padrões de interesse
    for (const pattern of this.patterns.interesse) {
      if (obs.includes(pattern) || ultimaInteracao.includes(pattern)) {
        score += this.weights.demonstrou_interesse;
      }
    }
    
    // Analisa padrões de desinteresse
    for (const pattern of this.patterns.desinteresse) {
      if (obs.includes(pattern) || ultimaInteracao.includes(pattern)) {
        score += this.weights.sem_interesse;
      }
    }
    
    // Verifica urgência
    for (const pattern of this.patterns.urgencia) {
      if (obs.includes(pattern) || ultimaInteracao.includes(pattern)) {
        score += 15;
      }
    }
    
    return Math.max(0, Math.min(100, score));
  }
  
  /**
   * Calcula score de interação
   */
  calculateInteractionScore(lead) {
    let score = 0;
    const diasSemResposta = this.daysSinceLastInteraction(lead);
    
    // Penaliza por dias sem resposta
    if (diasSemResposta < 3) {
      score = 90;
    } else if (diasSemResposta < 7) {
      score = 70;
    } else if (diasSemResposta < 14) {
      score = 50;
    } else if (diasSemResposta < 30) {
      score = 30;
    } else {
      score = 10;
    }
    
    // Bonus por resposta recente
    const ultimaInteracao = (lead['ÚLTIMA INTERAÇÃO'] || '').toLowerCase();
    if (ultimaInteracao.includes('respondeu')) {
      score += 20;
    }
    
    return Math.max(0, Math.min(100, score));
  }
  
  /**
   * Calcula score de valor
   */
  calculateValueScore(lead) {
    const valor = this.parseValue(lead['Valor Principal']);
    
    if (valor >= 500000) return 100;
    if (valor >= 200000) return 80;
    if (valor >= 100000) return 60;
    if (valor >= 50000) return 40;
    if (valor >= 20000) return 20;
    return 10;
  }
  
  /**
   * Calcula score temporal
   */
  calculateTimeScore(lead) {
    const idade = parseInt(lead.Idade) || 0;
    const prioridade = (lead.Prioridade || '').toLowerCase();
    
    let score = 50;
    
    // Idade ideal para conversão
    if (idade >= 45 && idade <= 70) {
      score += 20;
    }
    
    // Prioridade
    if (prioridade === 'alta') score += 30;
    if (prioridade === 'média') score += 15;
    if (prioridade === 'baixa') score -= 10;
    
    return Math.max(0, Math.min(100, score));
  }
  
  /**
   * Determina classificação final
   */
  determineClassification(score, lead) {
    const obs = (lead.OBS || '').toLowerCase();
    
    // Verificações prioritárias
    if (obs.includes('sem interesse')) {
      return {
        tipo: 'LEAD_MORTO',
        status: 'SEM_INTERESSE',
        prioridade: 'BAIXA',
        destino: 'Lead Morto',
        score: 0
      };
    }
    
    if (obs.includes('cotação') || obs.includes('cotacao')) {
      return {
        tipo: 'LEAD_ATIVO',
        status: 'COTACAO_SOLICITADA',
        prioridade: 'ALTA',
        destino: 'Lead Ativo',
        score: Math.max(score, 80)
      };
    }
    
    // Classificação por score
    if (score >= 80) {
      return {
        tipo: 'LEAD_QUENTE',
        status: 'ALTA_PROBABILIDADE',
        prioridade: 'ALTA',
        destino: 'Lead Ativo',
        score
      };
    } else if (score >= 60) {
      return {
        tipo: 'LEAD_MORNO',
        status: 'MEDIA_PROBABILIDADE',
        prioridade: 'MEDIA',
        destino: this.determineMessageTab(lead),
        score
      };
    } else if (score >= 40) {
      return {
        tipo: 'LEAD_FRIO',
        status: 'BAIXA_PROBABILIDADE',
        prioridade: 'BAIXA',
        destino: this.determineMessageTab(lead),
        score
      };
    } else {
      return {
        tipo: 'LEAD_MORTO',
        status: 'SEM_POTENCIAL',
        prioridade: 'BAIXA',
        destino: 'Lead Morto',
        score
      };
    }
  }
  
  /**
   * Determina aba de mensagem apropriada
   */
  determineMessageTab(lead) {
    const dias = this.daysSinceLastInteraction(lead);
    const tentativas = lead.TENTATIVAS || 1;
    
    if (tentativas >= 5) return '5ª Msg';
    if (tentativas >= 4) return '4ª Msg';
    if (tentativas >= 3) return '3ª Msg';
    if (tentativas >= 2) return '2ª Msg';
    return '1ª Msg';
  }
  
  /**
   * Prediz probabilidade de conversão
   */
  predictConversion(lead, score) {
    // Modelo simplificado de predição
    let probability = score / 100;
    
    // Ajustes baseados em histórico
    const obs = (lead.OBS || '').toLowerCase();
    if (obs.includes('cotação')) probability *= 1.5;
    if (obs.includes('urgente')) probability *= 1.3;
    if (obs.includes('dúvida')) probability *= 0.8;
    
    // Ajuste por valor
    const valor = this.parseValue(lead['Valor Principal']);
    if (valor > 100000) probability *= 1.2;
    
    return Math.min(1, probability);
  }
  
  /**
   * Prediz dias até fechamento
   */
  predictCloseDays(score) {
    if (score >= 90) return 3;
    if (score >= 80) return 7;
    if (score >= 70) return 14;
    if (score >= 60) return 21;
    if (score >= 50) return 30;
    return 60;
  }
  
  /**
   * Prediz valor esperado
   */
  predictValue(lead, conversionProbability) {
    const valor = this.parseValue(lead['Valor Principal']);
    return valor * conversionProbability * 0.8; // 80% do valor com probabilidade
  }
  
  /**
   * Sugere ações para o lead
   */
  suggestActions(classification, lead) {
    const actions = [];
    const dias = this.daysSinceLastInteraction(lead);
    
    switch (classification.tipo) {
      case 'LEAD_ATIVO':
      case 'LEAD_QUENTE':
        actions.push({
          action: 'CONTATO_IMEDIATO',
          priority: 'ALTA',
          channel: 'WHATSAPP',
          message: 'Enviar cotação personalizada',
          deadline: '24 horas'
        });
        actions.push({
          action: 'LIGACAO_FOLLOWUP',
          priority: 'ALTA',
          channel: 'TELEFONE',
          message: 'Ligar para fechar negócio',
          deadline: '48 horas'
        });
        break;
        
      case 'LEAD_MORNO':
        actions.push({
          action: 'MENSAGEM_FOLLOWUP',
          priority: 'MEDIA',
          channel: 'WHATSAPP',
          message: `Mensagem de follow-up #${Math.floor(dias / 7) + 1}`,
          deadline: '3 dias'
        });
        actions.push({
          action: 'CONTEUDO_EDUCATIVO',
          priority: 'BAIXA',
          channel: 'EMAIL',
          message: 'Enviar material informativo',
          deadline: '1 semana'
        });
        break;
        
      case 'LEAD_FRIO':
        actions.push({
          action: 'NUTRICAO_LEAD',
          priority: 'BAIXA',
          channel: 'WHATSAPP',
          message: 'Mensagem de nutrição mensal',
          deadline: '30 dias'
        });
        break;
        
      case 'LEAD_MORTO':
        actions.push({
          action: 'ARQUIVAR',
          priority: 'BAIXA',
          channel: 'SISTEMA',
          message: 'Mover para arquivo',
          deadline: 'Imediato'
        });
        break;
    }
    
    return actions;
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
   * Parse de valor monetário
   */
  parseValue(value) {
    if (!value || value === 'n/c') return 0;
    
    const cleanValue = value.toString()
      .replace(/[^0-9,.-]/g, '')
      .replace(',', '.');
    
    return parseFloat(cleanValue) || 0;
  }
  
  /**
   * Parse de data brasileira
   */
  parseDate(dateStr) {
    if (!dateStr) return new Date();
    
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
   * Processa batch de leads
   */
  classifyBatch(leads) {
    console.log(`🤖 Classificando ${leads.length} leads com IA...`);
    
    const results = leads.map(lead => this.classifyLead(lead));
    
    // Estatísticas do batch
    const stats = {
      total: results.length,
      leads_quentes: results.filter(r => r.classification.tipo === 'LEAD_QUENTE').length,
      leads_mornos: results.filter(r => r.classification.tipo === 'LEAD_MORNO').length,
      leads_frios: results.filter(r => r.classification.tipo === 'LEAD_FRIO').length,
      leads_mortos: results.filter(r => r.classification.tipo === 'LEAD_MORTO').length,
      avg_score: results.reduce((sum, r) => sum + r.scores.total, 0) / results.length,
      avg_conversion_probability: results.reduce((sum, r) => sum + r.predictions.conversion_probability, 0) / results.length
    };
    
    console.log('📊 Estatísticas de Classificação:', stats);
    
    return {
      classifications: results,
      statistics: stats,
      timestamp: new Date().toISOString()
    };
  }
}

// Export para n8n
if (typeof module !== 'undefined' && module.exports) {
  module.exports = LeadClassifierV3;
}

// Uso no n8n
const classifier = new LeadClassifierV3({
  TIMING_DIAS: 7,
  SCORE_THRESHOLD: 70,
  USE_AI_PREDICTIONS: true
});

const leads = $input.all().map(item => item.json);
const results = classifier.classifyBatch(leads);

return [{ json: results }];