import { registerRootComponent } from 'expo';
// IMPORTAÇÃO ADICIONADA
import messaging from '@react-native-firebase/messaging';

import App from './App';

// --- ADICIONADO: HANDLER DE BACKGROUND ---
// Isso deve ser registrado fora de qualquer componente React
// para funcionar quando o app estiver fechado ou em background.
messaging().setBackgroundMessageHandler(async remoteMessage => {
  console.log('Mensagem recebida em Background:', remoteMessage);

  // Como seu backend envia o campo 'notification', o próprio
  // sistema operacional vai exibir o alerta.
  // Você não precisa fazer nada aqui para a notificação aparecer.
});
// --- FIM DA ADIÇÃO ---

// Esta linha deve ser a última
registerRootComponent(App);