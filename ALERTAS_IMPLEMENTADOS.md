# Sistema de Alertas em Tempo Real - ARPA3I IoT

## Funcionalidades Implementadas

### 1. Processamento de Alertas do Servidor ESP32
- **Alertas de Queda**: Detecta quedas com localização específica
- **Alertas de Pânico**: Botão de pânico acionado
- **Alertas de Bateria Fraca**: Monitoramento de tensão dos dispositivos
- **Alertas de Sensor**: Vazamento de gás e fumaça

### 2. Sistema de Dispositivos Conectados
- **Status Online/Offline**: Monitoramento em tempo real
- **Dados de Heartbeat**: Uptime, reconexões, bateria, temperatura, WiFi
- **Cards Informativos**: Exibição detalhada de cada dispositivo

### 3. Interface de Usuário
- **Cards de Status**: Ambiente, Botão de Pânico, Detector de Queda
- **Alertas Visuais**: Modal de emergência para alertas críticos
- **ScrollView**: Interface responsiva para múltiplos dispositivos
- **Cores Dinâmicas**: Verde (seguro), Amarelo (atenção), Vermelho (perigo)

## Tipos de Alertas Suportados

### Alertas do Servidor ESP32
```javascript
// Estrutura dos alertas recebidos
{
  "type": "ALERTA",
  "sub_type": "QUEDA" | "PANICO",
  "dispositivo": "detector_quarto_01",
  "detalhes": {
    "local": "Quarto Principal"
  }
}
```

### Dados de Heartbeat
```javascript
// Estrutura do heartbeat
{
  "type": "HEARTBEAT",
  "deviceId": "detector_quarto_01",
  "data": {
    "uptime_ms": 3600000,
    "reconnects": 2,
    "tensao_mV": 3500,
    "temp_cpu_c": 45.2,
    "free_heap_b": 150000,
    "wifi_rssi_dbm": -65
  }
}
```

## Componentes Criados

### 1. AlertsContext.tsx (Atualizado)
- Processamento de mensagens WebSocket
- Gerenciamento de estado dos dispositivos
- Funções de confirmação de alertas

### 2. MainScreen.js (Atualizado)
- Interface principal com cards de status
- Exibição de dispositivos conectados
- ScrollView para melhor usabilidade

### 3. AlertStatusCard.js (Novo)
- Card de alerta ativo
- Indicadores visuais por tipo de alerta
- Timestamp dos alertas

## Fluxo de Funcionamento

1. **Conexão WebSocket**: Estabelece conexão com servidor ESP32
2. **Identificação**: Envia deviceId do cliente
3. **Monitoramento**: Recebe alertas e heartbeat em tempo real
4. **Exibição**: Mostra status e alertas na interface
5. **Confirmação**: Usuário pode confirmar ciência dos alertas

## Configurações

### URLs do Servidor
```javascript
const WEBSOCKET_URL = "ws://192.168.1.3:86/ws";
const API_URL = "http://192.168.1.3:86";
```

### Tipos de Alertas Processados
- `ALERTA` com `sub_type`: QUEDA, PANICO
- `HEARTBEAT`: Dados de status dos dispositivos
- `DEVICE_STATUS`: Status online/offline
- `sensor`: Dados do sensor de ambiente

## Melhorias Implementadas

1. **Interface Responsiva**: ScrollView para múltiplos dispositivos
2. **Alertas Visuais**: Cores e ícones específicos por tipo
3. **Dados Detalhados**: Informações completas dos dispositivos
4. **Tempo Real**: Atualizações instantâneas via WebSocket
5. **Confirmação**: Sistema de confirmação de ciência dos alertas

## Compatibilidade

- ✅ Servidor ESP32 v18 (Fase 2 Completa)
- ✅ Alertas de Queda e Pânico
- ✅ Monitoramento de Bateria
- ✅ Dados de Heartbeat Completos
- ✅ Status de Dispositivos Online/Offline
- ✅ Interface React Native Responsiva
