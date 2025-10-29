import { useEffect } from 'react';
import { useNavigation } from '@react-navigation/native';
import * as Notifications from 'expo-notifications';
import { getMessaging, onMessage, onNotificationOpenedApp, getInitialNotification } from '@react-native-firebase/messaging';
import { useAlerts } from './AlertsContext';

export default function NotificationHandler({ isAuthenticated }) {
  const navigation = useNavigation();
  const { devicesById } = useAlerts();

  useEffect(() => {
    if (!isAuthenticated) return;

    const messaging = getMessaging();

    const extractPayload = (remoteMessage) => {
      const data = remoteMessage?.data || {};
      const deviceId = data.deviceId || data.dispositivo || data.id || data.device_id;
      const rawType = data.alertType || data.alert_type || data.sub_type || data.type;
      const alertType = (rawType || '').toUpperCase() === 'QUEDA' ? 'QUEDA' : 'PANICO';
      return { deviceId, alertType };
    };

    const foregroundUnsub = onMessage(messaging, async (remoteMessage) => {
      await Notifications.scheduleNotificationAsync({
        content: {
          title: remoteMessage.notification?.title || 'Novo Alerta',
          body: remoteMessage.notification?.body || '',
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
      // Apenas navega. Estado do alerta deve vir do WebSocket/AsyncStorage.
      const dev = devicesById[deviceId];
      if (dev?.deviceType === 'gas_fumaca') {
        navigation.navigate('CategoryDevices', {
          categoryTitle: 'Sensores de Gás e Fumaça',
          categoryIcon: '🛡️',
          categoryKey: 'sensores',
        });
      } else if (dev?.deviceType === 'pulseira') {
        navigation.navigate('CategoryDevices', {
          categoryTitle: 'Pulseiras Assistivas',
          categoryIcon: '⌚',
          categoryKey: 'pulseira',
        });
      } else if (dev?.deviceType === 'barreira' || dev?.deviceType === 'microondas' || dev?.deviceType === 'detector') {
        navigation.navigate('CategoryDevices', {
          categoryTitle: 'Detectores de Queda',
          categoryIcon: '📱',
          categoryKey: 'detector',
        });
      } else {
        navigation.navigate('Main');
      }
    };

    const backgroundUnsub = onNotificationOpenedApp(messaging, (remoteMessage) => {
      handleTap(remoteMessage);
    });

    getInitialNotification(messaging).then((remoteMessage) => {
      if (remoteMessage) {
        handleTap(remoteMessage);
      }
    });

    return () => {
      foregroundUnsub();
      backgroundUnsub();
    };
  }, [isAuthenticated, devicesById, navigation]);

  return null;
}
