import * as Notifications from "expo-notifications";
import Constants from "expo-constants";
import { Platform } from "react-native";
import messaging from "@react-native-firebase/messaging";

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
});

function getBackendUrl() {
  return (
    process.env.EXPO_PUBLIC_API_URL ||
    (Constants.expoConfig?.extra && Constants.expoConfig.extra.apiUrl) ||
    "https://seu-projeto.vercel.app"
  );
}

async function ensureNotificationPermissions() {
  // Android: canal de notificação
  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync("default", {
      name: "default",
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: "#FF231F7C",
    });
  }
  // Expo: solicitar permissão (Android 13+ e iOS)
  const { status: existingStatus } = await Notifications.getPermissionsAsync();
  let finalStatus = existingStatus;
  if (finalStatus !== "granted") {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }
  return finalStatus === "granted";
}

export async function registerForFcmAndSendToBackend(userId) {
  const granted = await ensureNotificationPermissions();
  if (!granted) {
    console.warn("Permissão de notificações negada");
    return null;
  }

  // Obter FCM token via RNFirebase Messaging
  let fcmToken = null;
  try {
    // iOS: checar autorização do messaging
    if (Platform.OS === "ios") {
      const authStatus = await messaging().requestPermission();
      const enabled =
        authStatus === messaging.AuthorizationStatus.AUTHORIZED ||
        authStatus === messaging.AuthorizationStatus.PROVISIONAL;
      if (!enabled) {
        console.warn("Permissões de mensagens (FCM) não concedidas no iOS");
      }
    }
    fcmToken = await messaging().getToken();
  } catch (e) {
    console.error("Falha ao obter FCM token via messaging:", e);
  }

  if (!fcmToken) {
    console.warn("FCM token vazio. Verifique build com EAS/Dev Client e google-services.json.");
    return null;
  }

  try {
    const res = await fetch(`${getBackendUrl()}/api/register-token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: fcmToken, platform: Platform.OS, userId: userId || null }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      console.error("Backend não aceitou token:", json);
    } else {
      console.log("Token registrado no backend:", json);
    }
  } catch (err) {
    console.error("Erro ao enviar token para o backend:", err);
  }

  return fcmToken;
}

export function setupNotificationHandlers(onMessage) {
  const foregroundSubscription = Notifications.addNotificationReceivedListener((notification) => {
    if (onMessage) onMessage(notification);
  });

  const responseSubscription = Notifications.addNotificationResponseReceivedListener((response) => {
    console.log("Usuário interagiu com notificação:", response);
  });

  return () => {
    foregroundSubscription.remove();
    responseSubscription.remove();
  };
}