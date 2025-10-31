O aplicativo não está se comportando como deveria pelos seguintes motivos:
1º pode estar havendo uma concorrência de notificações, no primeiro teste eu enviei um alerta de queda seguido de um alerta de pânico. Na área de notificações só apareceu a notificação de queda. ao entrar no aplicativo também só havia o evento de queda, o evento pânico foi ignorado completamente.
2º ao enviar uma notificação de pânico e depois a notificação de queda, as duas notificações aparecem na área de notificações, e ao abrir o aplicativo igualmente aconteceu como no cenário 1, apenas o evento queda estava visível, e o evento pânico ausente.
3º Toda vez que abro o aplicativo preciso fazer login, o login era pra persistir pra não precisar ficar digitando login e senha toda vez que for usar o aplicativo
4º quero que apareça data e hora na notificação push e nos eventos ao abrir a página de cada dispositivo
5º ao apertar na notificação push, o aplicativo abre na tela inicial, e deveria abrir na página do respectivo dispositivo pra visualizar de imediato o evento

*To-do

Refatorar AlertsContext para suportar fila de alertas (em vez de único activeAlert) e processar múltiplos eventos concorrentes (PANICO/QUEDA).

Ajustar reidratação: buscar /alerts?status=pending e enfileirar todos os pendentes (com timestamps), evitar duplicidade usando conjunto de IDs vistos.

Persistir sessão do usuário (token/objeto user) no AsyncStorage e auto-login na inicialização.

Incluir data/hora nos eventos exibidos por dispositivo e no overlay/banners, e propagar timestamp vindo do servidor.

Implementar deep link/handling de clique na notificação push para navegar direto à tela do dispositivo correspondente.

Revisar envio de notificações no servidor (Arpa3i_Server.ino) para incluir timestamp no payload e IDs únicos por alerta.*

*sugestão de como resolver:

*Diagnóstico rápido

[Concorrência de alertas] Hoje há apenas um activeAlert (único). Quando chegam PANICO e QUEDA quase juntos, o último prevalece e o outro “some”.
[Reidratação parcial] A busca em /alerts?status=pending pega apenas “o mais recente” e ignora outros pendentes.
[Sessão] Não há auto-login: o usuário não é recarregado do AsyncStorage na inicialização.
[Timestamps] O WS/overlay e UI de dispositivos não exibem data/hora por falta de timestamp no payload e na renderização.
[Abertura por notificação] Falta tratar o clique na notificação com navegação direta ao dispositivo.

*Ações recomendadas

[Fila de alertas no cliente]
Alterar 
AlertsContext.tsx
 para usar alertsQueue: AlertItem[] em vez de único activeAlert.
AlertItem deve conter: id, deviceId, type, message, timestamp.
WS (
onMessage
) e reidratação (/alerts?status=pending) devem ENFILEIRAR todos pendentes, não apenas um.
Exibir o primeiro da fila; ao “OK/ciência”, remover da fila e passar ao próximo, mantendo devicesById[deviceId].lastAlertType.
[Reidratação robusta]
No boot: consultar /alerts?status=pending, filtrar por type in {PANICO,QUEDA}, ordenar por timestamp DESC, enfileirar TODOS os não vistos.
Persistir conjunto de IDs vistos em AsyncStorage (seenServerAlertIds) para evitar duplicidade.
[Persistência de sessão]
Na tela de login (ou provedor de usuário): após login bem-sucedido, salvar user em AsyncStorage (ex.: arp_user).
No app root: ao iniciar, carregar arp_user; se existir, setar user no estado e pular a tela de login.
[Data/hora em notificações e UI]
Servidor 
Arpa3i_Server.ino
:
Incluir timestamp nos broadcasts WS (
broadcastPanicAlert
 e 
broadcastFallAlert
), usando 
getFormattedTime()
 e, opcional, epoch_ms para ordenação.
Opcional: incluir alertId único (contador global incrementa) para controle no cliente.
Cliente:
Mostrar timestamp no overlay global e nos cards por dispositivo.
Manter lastAlertTimestamp em devicesById[deviceId] para exibir na tela do dispositivo.
[Abrir direto na página do dispositivo via push]
Incluir em cada push notification data: { deviceId, alertType, timestamp }.
No handler de resposta da notificação (App root), chamar navigation.navigate('DeviceDetails', { deviceId })

Onde alterar
Cliente
AlertsContext.tsx
:
Substituir activeAlert: ActiveAlert | null por alertsQueue: AlertItem[] e currentAlert: AlertItem | null.
WS ALERTA:
Enfileirar AlertItem com timestamp vindo do servidor (ou Date.now() como fallback).
Atualizar devicesById[deviceId].lastAlertType e lastAlertTimestamp.
Reidratação (/alerts?status=pending):
Enfileirar todos, marcar IDs vistos em AsyncStorage.
Overlay global:
Renderizar currentAlert com timestamp formatado. Botão “Ciente” retira da fila e envia CIENCIA_ALERTA.
MainScreen.js
:
Exibir lastAlertTimestamp nos cards e na “pílula” de alerta.
App root (não está no workspace, mas fica a orientação):
Auto-login: carregar arp_user no boot.
Handler de clique na notificação: navegar para DeviceDetails.
Servidor
arduino_code/Arpa3i_Server.ino
:
broadcastPanicAlert
 e 
broadcastFallAlert
:
Adicionar campos timestamp e opcional epoch_ms e alertId.
Exemplo:
doc["timestamp"] = getFormattedTime();
doc["epoch_ms"] = millis();
static unsigned long alertCounter = 0; doc["alertId"] = ++alertCounter;
Opcional: também incluir timestamp nos logs e no JSON do endpoint /alerts.
Plano de implementação (curto e seguro)
Passo 1 (cliente): implementar fila de alertas em 
AlertsContext.tsx
 e overlay com data/hora. Ajustar reidratação para múltiplos pendentes.
Passo 2 (servidor): incluir timestamp/alertId no WS broadcast.
Passo 3 (cliente): exibir timestamp nos cards e tela do dispositivo.
Passo 4: auto-login com AsyncStorage e skip da tela de login.
Passo 5: lidar com clique na notificação para deep link à tela do dispositivo.
Perguntas rápidas para ajustar
Quer que eu faça a refatoração da fila de alertas agora (Passo 1) e já ajuste o servidor para enviar timestamp/alertId (Passo 2)?
Qual lib de notificações está sendo usada (Expo Notifications, Firebase/FCM)? Para implementar o deep link preciso apontar o handler correto.

Deu tudo errado : 


Status das 5 pendências
[Concorrência de alertas] Resolvido
AlertsContext.tsx
: troquei o modelo de “alerta único” por uma fila de alertas (alertsQueue: AlertItem[]). Cada evento PANICO/QUEDA que chega via WS ou reidratação do servidor é enfileirado com id, deviceId, type, message, timestamp.
O activeAlert agora reflete automaticamente o primeiro item da fila. Ao clicar “OK”, removo o primeiro item e o próximo aparece.
[Reidratação de múltiplos pendentes] Resolvido
No 
onOpen
 do WS, chamo GET ${SERVER_HTTP_BASE}/alerts?status=pending, filtro PANICO/QUEDA, ordeno por timestamp (desc) e enfileiro TODOS os que ainda não foram vistos.
Evito duplicidade com seenServerAlertIds em AsyncStorage.
[Sessão persistida] Resolvido
App.js
: auto-login com AsyncStorage (arp_user). Após login, salvo user; ao iniciar o app, recarrego e pulo o login.
Logout limpa arp_user.
[Data/hora] Parcialmente resolvido
AlertsContext.tsx
: overlay global agora exibe timestamp formatado.
Adicionei lastAlertAt em devicesById[deviceId] para futura exibição por dispositivo (precisamos ajustar a UI dos cards e/ou tela do dispositivo para mostrar).
Servidor: preciso incluir timestamp/epoch_ms no payload WS. Não consegui aplicar patch automático no 
Arpa3i_Server.ino
 por limitação da ferramenta. Abaixo envio o trecho exato para você aplicar manualmente.
[Abrir direto pelo push] Resolvido (navegação até Main)
App.js
: tratei clique da notificação via FCM:
Em background: messaging().onNotificationOpenedApp
Em cold start: messaging().getInitialNotification()
Encaminho para a rota Main com params { focusDeviceId, alertType } se data.deviceId vier no push.
Observação: precisamos fazer o 
MainScreen.js
 ler esses params e focar o dispositivo (rolar/destacar). Se preferir abrir uma tela específica, crie/indique a tela “DeviceDetails” que eu ligo a navegação.
Mudanças aplicadas
AlertsContext.tsx
Criado 
AlertItem
 e alertsQueue: AlertItem[].
activeAlert agora sincroniza com o primeiro item da fila (useEffect).
WS “ALERTA”:
PANICO/QUEDA: enfileiro com timestamp, atualizo devicesById[deviceId].lastAlertType e lastAlertAt.
Reidratação via /alerts?status=pending:
Enfileiro todos os pendentes não vistos (24h), persisto seenServerAlertIds.
Overlay global: exibe título, mensagem e data/hora do alerta.
App.js
Auto-login com AsyncStorage (arp_user).
Persiste sessão no login e limpa no logout.
FCM click handling: navega para Main com focusDeviceId/alertType via navigationRef.
O que ainda vou fazer (preciso do seu OK)
[Servidor: incluir timestamp no WS]
Aplique manualmente esses trechos em 
arduino_code/Arpa3i_Server.ino
:
cpp
// Dentro de broadcastPanicAlert(String dispositivo)
StaticJsonDocument<200> doc;
doc["type"] = "ALERTA";
doc["sub_type"] = "PANICO";
doc["dispositivo"] = dispositivo;
// adicionar:
doc["timestamp"] = getFormattedTime();
doc["epoch_ms"] = (uint32_t)millis();
String json;
serializeJson(doc, json);
ws.textAll(json);
cpp
// Dentro de broadcastFallAlert(String local, String dispositivo)
StaticJsonDocument<200> doc;
doc["type"] = "ALERTA";
doc["sub_type"] = "QUEDA";
doc["dispositivo"] = dispositivo;
JsonObject detalhes = doc.createNestedObject("detalhes");
detalhes["local"] = local;
// adicionar:
doc["timestamp"] = getFormattedTime();
doc["epoch_ms"] = (uint32_t)millis();
String json;
serializeJson(doc, json);
ws.textAll(json);
[MainScreen.js: focar dispositivo ao abrir por push]
Ler route.params?.focusDeviceId e:
Destacar o card correspondente e/ou rolar lista até ele.
Opcional: navegar para uma tela “DeviceDetails” (se você quiser que eu crie esta tela, confirmo o layout).
[Exibir data/hora por dispositivo]
Usar devicesById[deviceId].lastAlertType e lastAlertAt para mostrar a última data/hora do evento no card e na tela do dispositivo.
Como testar
Concorrência:
Envie PANICO e depois QUEDA (ou vice-versa). A fila deve mostrar os 2 alertas, um após o outro.
Reidratação:
Com o app fechado, gerar alertas. Abrir o app: a fila deve recompor os pendentes do servidor.
Sessão:
Faça login, feche e reabra o app: deve entrar direto sem pedir credenciais.
Push click:
Envie push com data.deviceId e data.alertType. Clique na notificação:
Deve abrir no Main com o focusDeviceId disponível para destacar o card (implemento a parte do destaque após seu OK).
Data/hora:
Overlay deve exibir a data/hora. Após eu ajustar a UI dos cards, os cards mostrarão a última data/hora do alerta.
Próximos passos
Posso:
Implementar o foco/destaque no 
MainScreen.js
.
Criar “DeviceDetails” e navegar direto para lá no clique da notificação (se preferir).
Assim que você aplicar o trecho no 
Arpa3i_Server.ino
 (timestamp/epoch_ms), confirmamos no app a exibição correta da hora do servidor.
Deseja que eu:

Ajuste o 
MainScreen.js
 para destacar/rolar até focusDeviceId?
Crie a tela “DeviceDetails” e redirecione a notificação para ela?