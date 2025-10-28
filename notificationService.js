import * as Notifications from "expo-notifications";
import Constants from "expo-constants";
import { Platform } from "react-native";
import { getApp } from "@react-native-firebase/app";
import {
  getMessaging,
  getToken as getFcmToken,
  requestPermission as requestMessagingPermission,
  AuthorizationStatus,
} from "@react-native-firebase/messaging";

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
  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync("default", {
      name: "default",
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: "#FF231F7C",
    });
  }
  const { status: existingStatus } = await Notifications.getPermissionsAsync();
  let finalStatus = existingStatus;
  if (finalStatus !== "granted") {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }
  return finalStatus === "granted";
}

// ESTA FUNÇÃO ESTÁ INTACTA E CORRETA
export async function registerForFcmAndSendToBackend(userId) {
  const granted = await ensureNotificationPermissions();
  if (!granted) {
    console.warn("Permissão de notificações negada");
    return null;
  }

  let fcmToken = null;
  try {
    const app = getApp();
    const messaging = getMessaging(app);

    if (Platform.OS === "ios") {
      const authStatus = await requestMessagingPermission(messaging);
      const enabled =
        authStatus === AuthorizationStatus.AUTHORIZED ||
        authStatus === AuthorizationStatus.PROVISIONAL;
      if (!enabled) {
        console.warn("Permissões de mensagens (FCM) não concedidas no iOS");
      }
    }

    fcmToken = await getFcmToken(messaging);
  } catch (e) {
    console.error(
      "Falha ao obter FCM token via messaging (módulo nativo ausente ou build sem Dev Client/EAS):",
      e
    );
  }

  if (!fcmToken) {
    console.warn(
      "FCM token vazio. Reinstale o Dev Client após configurar plugins e google-services.json, e abra com --dev-client."
    );
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
