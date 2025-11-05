// v3 - Lógica de Deteção de Queda Inteligente (Anti-Falso Positivo)
// - Baseado na v2 estável.
// - A função verificarBarreira() foi completamente refeita para usar uma máquina de estados mais robusta.
// - Implementada a condição de sequência: uma queda só é considerada se o sensor
//   superior for interrompido ANTES do sensor inferior.
// - Adicionado um estado de "memória" (ESTADO_PASSAGEM_CONCLUIDA) que dura 1.5 segundos
//   após uma pessoa passar, permitindo detetar uma queda que ocorra logo a seguir à passagem.
// - Esta nova lógica previne falsos positivos causados por animais de estimação ou
//   objetos que obstruam apenas o sensor inferior.

// - CORRIGIDO: Invertida a lógica de leitura dos sensores. Agora, o estado "interrompido"
//   corresponde a um sinal ALTO (HIGH), alinhando o software com o comportamento
//   padrão dos módulos recetores de infravermelhos. Esta é a correção principal
//   para o bug de falsos positivos contínuos.
// - ADICIONADO: Um período de tolerância de 5 segundos no arranque (STARTUP_GRACE_PERIOD_MS).
//   A lógica de deteção só é ativada após este período, garantindo que os sensores
//   e o microcontrolador tenham tempo para estabilizar os seus sinais elétricos.

//   Inversão da Lógica do Sensor via Botão
// - Baseado na v3 estável.
// - ADICIONADO: Uma nova função para o botão de reset. Um clique curto
//   (pressionar e soltar) agora inverte a lógica de deteção dos sensores
//   (alterna entre HIGH e LOW para o estado "interrompido").
// - ADICIONADO: A preferência da lógica (normal ou invertida) é guardada na
//   memória EEPROM e carregada no arranque, garantindo que a configuração persista.
// - MELHORADO: A função handleButton() foi refeita para detetar a ação de
//   soltar o botão, permitindo diferenciar entre um clique curto e um pressionar longo.

// v5 - Correção do Algoritmo de Deteção de Falsos Positivos
// - Baseado na v4 estável.
// - CORRIGIDO: A máquina de estados na função verificarBarreira() foi refeita
//   para eliminar os falsos positivos que ocorriam quando uma pessoa em pé
//   interrompia ambos os sensores.
// - MELHORADO: A transição para o estado de "Queda Potencial" agora só ocorre
//   após o sistema confirmar que a parte superior do corpo de uma pessoa já
//   passou pelo sensor superior, implementando rigorosamente a lógica de sequência.

// v6 - Resposta ao App Broadcast
// - Baseado na v5 estável.
// - Modificada a função webSocketEvent para escutar por mensagens
//   do tipo "SYSTEM_BROADCAST" com o "broadcast_type" = "REQUEST_DEVICE_STATUS".
// - Ao receber essa solicitação (enviada pelo app ao iniciar),
//   o dispositivo responde imediatamente com seu sendHeartbeat().
//   Isso corrige o delay de status no app.
// - Aumentado o JsonDocument em webSocketEvent para 300.

//V7 - retirado o envio de ping dos clientes

#include <ESP8266WiFi.h>
#include <ESP8266WebServer.h>
#include <WiFiManager.h>
#include <WebSocketsClient.h>
#include <ArduinoJson.h>
#include <EEPROM.h>

ADC_MODE(ADC_VCC);

// --- CONFIGURAÇÕES DE REDE E DISPOSITIVO ---
char ws_host[20] = "192.168.1.6";
char deviceId[40] = "barreira_corredor_1";

// --- MAPEAMENTO DE PINOS PARA O ESP-01 (FINAL) ---
const int SENSOR_INF_PIN = 0;   // Usado para deteção e reset na inicialização. Requer PULL-UP EXTERNO.
const int BUTTON_RESET_PIN = 1; // Pino TX, agora usado para o botão de reset físico.
const int LED_PIN = 2;          // Pino do LED de Status.
const int SENSOR_SUP_PIN = 3;   // Pino RX, agora usado para o sensor superior.

// --- LÓGICA DE DETEÇÃO E RESET ---
const long TEMPO_CONFIRMACAO_QUEDA_MS = 3000;
const long TEMPO_RESET_FABRICA_MS = 10000;
const long MEMORIA_PASSAGEM_MS = 1500; // Tempo em que o sistema "lembra" que alguém passou.
const long STARTUP_GRACE_PERIOD_MS = 5000; // 5 segundos de tolerância no arranque.
unsigned long startupGracePeriodEnd = 0;
bool logicaInvertida = false; // false = HIGH é interrompido, true = LOW é interrompido

enum EstadoBarreira { ESTADO_LIVRE, ESTADO_PASSANDO_EM_PE, ESTADO_PASSAGEM_CONCLUIDA, ESTADO_QUEDA_POTENCIAL };
EstadoBarreira estadoAtual = ESTADO_LIVRE;
unsigned long tempoInicioQuedaPotencial = 0;
unsigned long tempoFimPassagem = 0;

// --- CONTROLE DO BOTÃO ---
int lastButtonState = HIGH;
unsigned long buttonPressStartTime = 0;

// --- CONTROLO DE COMUNICAÇÃO FIÁVEL ---
volatile bool quedaAlertPending = false;
volatile bool quedaAlertAwaitingAck = false;
unsigned long quedaAlertSentTime = 0;
const long RESEND_INTERVAL = 10000;

// --- ESTADOS DO LED DE STATUS ---
enum LedState { WIFI_CONNECTING, SERVER_DISCONNECTED, SERVER_CONNECTED, AWAITING_ACK };
volatile LedState currentLedState = WIFI_CONNECTING;
unsigned long ledPreviousMillis = 0;
bool ledIsOn = false;

// --- VARIÁVEIS GLOBAIS ---
WebSocketsClient webSocket;
bool isConnected = false;
unsigned long lastHeartbeatTime = 0;
const long heartbeatInterval = 15000;
unsigned long reconnectCounter = 0;
volatile bool sendInitialHeartbeat = false;

// --- PROTÓTIPOS ---
void sendHeartbeat();
void saveConfig();
void loadConfig();
void enviarAlertaDeQueda();
void handleQuedaResend();
void verificarBarreira();
void webSocketEvent(WStype_t type, uint8_t * payload, size_t length);
void triggerFactoryReset();
void handleButton();
void handleLed();
void wifiManagerCallback(WiFiManager *myWiFiManager);
void inverterLogicaDoSensor();

void sendHelloIdentification() {
  if (!isConnected) return;
  StaticJsonDocument<80> doc;
  doc["deviceId"] = deviceId;
  String json; serializeJson(doc, json);
  webSocket.sendTXT(json);
}

void triggerFactoryReset() {
  for(int i=0; i<10; i++) {
    digitalWrite(LED_PIN, !digitalRead(LED_PIN));
    delay(100);
  }
  WiFiManager wm;
  wm.resetSettings();
  EEPROM.begin(512); // Aumentar tamanho para comportar nova flag
  for (int i = 0; i < 512; i++) EEPROM.write(i, 0);
  EEPROM.commit();
  EEPROM.end();
  ESP.restart();
}

void saveConfig() {
  EEPROM.begin(512);
  for (int i = 0; i < 40; ++i) EEPROM.write(i, deviceId[i]);
  for (int i = 0; i < 20; ++i) EEPROM.write(i + 40, ws_host[i]);
  EEPROM.write(128, logicaInvertida ? 1 : 0); // Salva o estado da lógica
  EEPROM.commit();
  EEPROM.end();
}

void loadConfig() {
  EEPROM.begin(512);
  for (int i = 0; i < 40; ++i) deviceId[i] = EEPROM.read(i);
  deviceId[39] = '\0';
  for (int i = 0; i < 20; ++i) ws_host[i] = EEPROM.read(i + 40);
  ws_host[19] = '\0';
  logicaInvertida = (EEPROM.read(128) == 1); // Carrega o estado da lógica
  EEPROM.end();
}

void inverterLogicaDoSensor() {
  logicaInvertida = !logicaInvertida;
  saveConfig(); // Salva a nova configuração na EEPROM

  // Feedback visual para o usuário
  for (int i = 0; i < 4; i++) {
    digitalWrite(LED_PIN, !digitalRead(LED_PIN));
    delay(100);
  }
}


void wifiManagerCallback(WiFiManager *myWiFiManager) {
  ESP.wdtFeed();
}

void setup() {
  pinMode(LED_PIN, OUTPUT);
  digitalWrite(LED_PIN, HIGH); 
  
  pinMode(SENSOR_INF_PIN, INPUT_PULLUP);
  pinMode(SENSOR_SUP_PIN, INPUT_PULLUP);
  pinMode(BUTTON_RESET_PIN, INPUT_PULLUP);
  delay(100);

  loadConfig(); // Carrega configurações primeiro, incluindo a lógica do sensor

  if (digitalRead(BUTTON_RESET_PIN) == LOW) {
    unsigned long pressStartTime = millis();
    bool resetCancelled = false;
    while (millis() - pressStartTime < 5000) {
      if (digitalRead(BUTTON_RESET_PIN) == HIGH) {
        resetCancelled = true;
        break;
      }
      delay(100);
    }
    if (!resetCancelled) {
      triggerFactoryReset();
    }
  }

  WiFiManager wm;
  wm.setAPCallback(wifiManagerCallback);
  WiFiManagerParameter custom_device_id("deviceid", "ID da Barreira", deviceId, 40);
  WiFiManagerParameter custom_server_ip("serverip", "IP do Servidor", ws_host, 20);
  wm.addParameter(&custom_device_id);
  wm.addParameter(&custom_server_ip);
  wm.setConfigPortalTimeout(180);

  String apName = "SensorBarreiraAP-" + String(ESP.getChipId(), HEX);

  currentLedState = WIFI_CONNECTING;
  if (!wm.autoConnect(apName.c_str())) {
    delay(5000);
    ESP.restart();
  }

  if (strcmp(deviceId, custom_device_id.getValue()) != 0 || strcmp(ws_host, custom_server_ip.getValue()) != 0) {
    strcpy(deviceId, custom_device_id.getValue());
    strcpy(ws_host, custom_server_ip.getValue());
    saveConfig();
  }
  
  webSocket.begin(ws_host, 86, "/ws");
  webSocket.onEvent(webSocketEvent);
  webSocket.setReconnectInterval(5000);
  //webSocket.enableHeartbeat(20000, 5000, 2);

  // Inicia o período de tolerância
  startupGracePeriodEnd = millis() + STARTUP_GRACE_PERIOD_MS;
}

void loop() {
  ESP.wdtFeed();
  webSocket.loop();
  
  if (millis() > startupGracePeriodEnd) {
    verificarBarreira();
  }
  
  handleButton();
  handleLed();
  handleQuedaResend();

  if (sendInitialHeartbeat) {
    sendInitialHeartbeat = false;
    sendHeartbeat();
  }

  if (isConnected && millis() - lastHeartbeatTime > heartbeatInterval) {
    sendHeartbeat();
  }
}

// << ALGORITMO DE DETECÇÃO CORRIGIDO >>
void verificarBarreira() {
  int nivelInterrupcao = logicaInvertida ? LOW : HIGH;
  bool supInterrompido = (digitalRead(SENSOR_SUP_PIN) == nivelInterrupcao);
  bool infInterrompido = (digitalRead(SENSOR_INF_PIN) == nivelInterrupcao);
  unsigned long agora = millis();

  switch (estadoAtual) {
    case ESTADO_LIVRE:
      // Cenário 3 (Pet): Ignora o sensor inferior se o superior não foi acionado.
      if (supInterrompido) {
        estadoAtual = ESTADO_PASSANDO_EM_PE;
      }
      break;

    case ESTADO_PASSANDO_EM_PE:
      // Se a pessoa terminar de passar por cima, entra no estado de "memória".
      // Cenário 2 (Pessoa em pé) é tratado aqui: se ambos estão interrompidos,
      // o sistema simplesmente espera a pessoa sair do sensor superior.
      if (!supInterrompido) {
        estadoAtual = ESTADO_PASSAGEM_CONCLUIDA;
        tempoFimPassagem = agora;
      } 
      break;
    
    case ESTADO_PASSAGEM_CONCLUIDA:
      // Cenário 4 (Queda): Se o sensor de baixo for ativado logo após a passagem 
      // (dentro da janela de memória), é uma queda potencial.
      if (infInterrompido) {
        estadoAtual = ESTADO_QUEDA_POTENCIAL;
        tempoInicioQuedaPotencial = agora;
      } 
      // Se o tempo de memória expirar sem evento, volta ao estado livre.
      else if (agora - tempoFimPassagem > MEMORIA_PASSAGEM_MS) {
        estadoAtual = ESTADO_LIVRE;
      }
      break;

    case ESTADO_QUEDA_POTENCIAL:
      // Se o sensor inferior for liberado, foi um alarme falso ou a pessoa levantou-se.
      if (!infInterrompido) {
        estadoAtual = ESTADO_LIVRE;
        tempoInicioQuedaPotencial = 0;
      } 
      // Se o sensor inferior permanecer obstruído pelo tempo de confirmação, envie o alerta.
      else if (agora - tempoInicioQuedaPotencial > TEMPO_CONFIRMACAO_QUEDA_MS) {
        enviarAlertaDeQueda();
        estadoAtual = ESTADO_LIVRE; // Reseta o estado após enviar o alerta.
        tempoInicioQuedaPotencial = 0;
      }
      break;
  }
}

void handleButton() {
  int reading = digitalRead(BUTTON_RESET_PIN);

  // Deteta a transição de solto para pressionado
  if (reading == LOW && lastButtonState == HIGH) {
    buttonPressStartTime = millis();
  }
  
  // Deteta a transição de pressionado para solto (o clique)
  else if (reading == HIGH && lastButtonState == LOW) {
    unsigned long pressDuration = millis() - buttonPressStartTime;
    if (pressDuration < TEMPO_RESET_FABRICA_MS) {
      // Foi um clique curto, inverte a lógica
      inverterLogicaDoSensor();
    }
  }

  // Verifica continuamente se é um pressionar longo para o reset
  if (reading == LOW && (millis() - buttonPressStartTime > TEMPO_RESET_FABRICA_MS)) {
     triggerFactoryReset();
  }

  lastButtonState = reading;
}


void handleLed() {
    unsigned long currentMillis = millis();
    unsigned long interval = 500;
    switch (currentLedState) {
        case WIFI_CONNECTING: interval = 500; break;
        case SERVER_DISCONNECTED: interval = 150; break;
        case AWAITING_ACK: interval = 250; break;
        case SERVER_CONNECTED:
            if (!ledIsOn) {
                digitalWrite(LED_PIN, LOW);
                ledIsOn = true;
            }
            return; 
    }
    if (currentMillis - ledPreviousMillis >= interval) {
        ledPreviousMillis = currentMillis;
        digitalWrite(LED_PIN, !digitalRead(LED_PIN));
        ledIsOn = (digitalRead(LED_PIN) == LOW);
    }
}

void enviarAlertaDeQueda() {
  if (quedaAlertAwaitingAck) return;
  
  if (!isConnected) {
    quedaAlertPending = true;
    return;
  }

  StaticJsonDocument<200> doc;
  doc["type"] = "ALERTA";
  doc["sub_type"] = "QUEDA";
  doc["deviceId"] = deviceId;
  JsonObject detalhes = doc.createNestedObject("detalhes");
  detalhes["local"] = "Barreira Corredor";
  String json;
  serializeJson(doc, json);
  
  webSocket.sendTXT(json);
  
  quedaAlertPending = false;
  quedaAlertAwaitingAck = true;
  quedaAlertSentTime = millis();
  currentLedState = AWAITING_ACK;
}

void handleQuedaResend() {
  if (quedaAlertAwaitingAck && (millis() - quedaAlertSentTime > RESEND_INTERVAL)) {
    enviarAlertaDeQueda();
  }
}

void sendHeartbeat() {
  if (!isConnected) return;

  StaticJsonDocument<256> doc;
  doc["type"] = "DEVICE_STATUS";
  doc["deviceId"] = deviceId;
  doc["status"] = "online";
  doc["uptimeSec"] = (long)(millis() / 1000);
  doc["rssiDbm"] = (int)WiFi.RSSI();
  doc["reconnects"] = (int)reconnectCounter;
  doc["heapB"] = (long)ESP.getFreeHeap();
  doc["batteryMv"] = (int)ESP.getVcc();

  String json; serializeJson(doc, json);
  webSocket.sendTXT(json);
  lastHeartbeatTime = millis();
}

void webSocketEvent(WStype_t type, uint8_t * payload, size_t length) {
  switch (type) {
    case WStype_DISCONNECTED:
      isConnected = false;
      currentLedState = SERVER_DISCONNECTED;
      reconnectCounter++;
      break;
    case WStype_CONNECTED:
      isConnected = true;
      currentLedState = SERVER_CONNECTED;
      sendInitialHeartbeat = true;
      // Identificação inicial para mapear deviceId no servidor
      sendHelloIdentification();
      if (quedaAlertPending) {
        enviarAlertaDeQueda();
      }
      break;
    case WStype_TEXT:
      {
        // Aumentado para 300 para acomodar mensagens de broadcast
        StaticJsonDocument<300> doc;
        if (deserializeJson(doc, payload).code() == DeserializationError::Ok) {
          const char* msg_type = doc["type"] | "";
          
          if (strcmp(msg_type, "ACK") == 0) {
            const char* acked_alert = doc["acked_alert"] | "";
            if (strcmp(acked_alert, "QUEDA") == 0) {
              quedaAlertAwaitingAck = false;
              currentLedState = SERVER_CONNECTED;
            }
          }
          // --- INÍCIO DA MODIFICAÇÃO (v6) ---
          else if (strcmp(msg_type, "SYSTEM_BROADCAST") == 0) {
            JsonObject data = doc["data"];
            const char* broadcast_type = data["broadcast_type"] | "";
            
            // Verifica se é a solicitação de status vinda do app
            if (strcmp(broadcast_type, "REQUEST_DEVICE_STATUS") == 0) {
              // Serial.println("Solicitacao de status recebida. Respondendo com heartbeat..."); // Descomente se precisar depurar
              sendHeartbeat(); 
            }
          }
          // --- FIM DA MODIFICAÇÃO (v6) ---
          else if (strcmp(msg_type, "ping") == 0) {
            // Responde ao ping do servidor com heartbeat imediato
            sendHeartbeat();
          }
        }
        break;
      }
    default:
      break;
  }
}
