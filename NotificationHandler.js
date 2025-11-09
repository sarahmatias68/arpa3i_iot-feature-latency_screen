import { useEffect } from 'react';
import { useNavigation } from '@react-navigation/native';
import * as Notifications from 'expo-notifications';
import { getMessaging, onMessage } from '@react-native-firebase/messaging';
import { useAlerts } from './AlertsContext';

export default function NotificationHandler({ isAuthenticated }) {
  const navigation = useNavigation();
  const { devicesById } = useAlerts();
<<<<<<< HEAD
  const SERVER_HTTP_BASE = "http://192.168.1.6:86";
=======
  const SERVER_HTTP_BASE = "http://192.168.1.7:86";
>>>>>>> parent of ace65bc (updates)

  useEffect(() => {
    if (!isAuthenticated) return;

    const messaging = getMessaging();

    const extractPayload = (remoteMessage) => {
      const data = remoteMessage?.data || {};
      const deviceId = data.deviceId || data.dispositivo || data.id || data.device_id;
      const rawType = data.alertType || data.alert_type || data.sub_type || data.type;
      const alertType = (rawType || '').toUpperCase() === 'QUEDA' ? 'QUEDA' : 'PANICO';
      const ts = data.timestamp || data.ts || remoteMessage?.sentTime || Date.now();
      return { deviceId, alertType, ts };
    };

    const foregroundUnsub = onMessage(messaging, async (remoteMessage) => {
      const { ts } = extractPayload(remoteMessage);
      const when = new Date(Number(ts) || Date.now()).toLocaleString();
      const baseTitle = remoteMessage.notification?.title || 'Novo Alerta';
      const baseBody = remoteMessage.notification?.body || '';
      await Notifications.scheduleNotificationAsync({
        content: {
          title: `${baseTitle}`,
          body: baseBody ? `${baseBody} • ${when}` : `${when}`,
          data: remoteMessage.data,
        },
        trigger: null,
      });
    });

    const handleTap = async (remoteMessage) => {
      if (!remoteMessage) return;
      const { deviceId, alertType } = extractPayload(remoteMessage);
      if (!deviceId || !alertType) {
        navigation.navigate('Main');
        return;
      }
      // Garante tipo via servidor se ainda não carregou no contexto (app frio)
      let dev = devicesById[deviceId];
      let dtype = dev?.deviceType;
      if (!dtype) {
        try {
          const res = await fetch(`${SERVER_HTTP_BASE}/devices`);
          if (res.ok) {
            const items = await res.json();
            const found = items.find(it => it.deviceId === deviceId);
            dtype = found?.deviceType || dtype;
          }
        } catch (_) {}
      }
      if (dtype === 'gas_fumaca') {
        navigation.navigate('CategoryDevices', {
          categoryTitle: 'Sensores de Gás e Fumaça',
          categoryIcon: 'flame-outline',
          categoryKey: 'sensores',
          focusDeviceId: deviceId,
        });
      } else if (dtype === 'pulseira') {
        navigation.navigate('CategoryDevices', {
          categoryTitle: 'Pulseiras Assistivas',
          categoryIcon: 'watch-outline',
          categoryKey: 'pulseira',
          focusDeviceId: deviceId,
        });
      } else if (dtype === 'barreira' || dtype === 'microondas' || dtype === 'detector') {
        navigation.navigate('CategoryDevices', {
          categoryTitle: 'Detectores de Queda',
          categoryIcon: 'body-outline',
          categoryKey: 'detector',
          focusDeviceId: deviceId,
        });
      } else {
        // Fallback: abre categoria "Detectores" com foco no device
        navigation.navigate('CategoryDevices', {
          categoryTitle: 'Detectores de Queda',
          categoryIcon: 'body-outline',
          categoryKey: 'detector',
          focusDeviceId: deviceId,
        });
      }
    };

    return () => {
      foregroundUnsub();
    };
  }, [isAuthenticated, devicesById, navigation]);

  return null;
}
