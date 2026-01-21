import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { WsConnection } from "./wsConnection";

// --- CONFIGURAÇÕES DE REDE ---
const SERVER_IP = "painel.arpa3i.me/ui"; 
const WEBSOCKET_URL = `ws://${SERVER_IP}/ws`;
const SERVER_HTTP_BASE = `http://${SERVER_IP}`;

const AlertsContext = createContext(undefined);

export const useAlerts = () => {
  const context = useContext(AlertsContext);
  if (!context) throw new Error("useAlerts deve ser usado dentro de um AlertsProvider");
  return context;
};

export const AlertsProvider = ({ children, user }) => {
  const [connectionStatus, setConnectionStatus] = useState("Desconectado");
  const [devicesById, setDevicesById] = useState({});
  const [alertsQueue, setAlertsQueue] = useState([]);
  const [activeAlert, setActiveAlert] = useState(null);
  const ws = useRef(null);

  // 1. Sincronização com a Timeline (v48)
  const syncTimeline = useCallback(async () => {
    try {
      const res = await fetch(`${SERVER_HTTP_BASE}/timeline`);
      if (!res.ok) return;
      const timeline = await res.json();

      const seenJson = await AsyncStorage.getItem('seenAlertIds');
      const seenIds = new Set(seenJson ? JSON.parse(seenJson) : []);
      const newAlertsFromServer = [];

      timeline
        .filter(item => item.category === "ALERT" || item.severity === "CRITICAL")
        .forEach(event => {
          const strId = String(event.id);
          if (!seenIds.has(strId)) {
            newAlertsFromServer.push({
              id: strId,
              deviceId: event.source,
              type: event.description.includes("QUEDA") ? "QUEDA" : 
                    event.description.includes("GAS") ? "GAS" : 
                    event.description.includes("FUMACA") ? "FUMACA" : "PANICO",
              message: event.description,
              timestamp: new Date(event.timestamp).getTime()
            });
            seenIds.add(strId);
          }
        });

      if (newAlertsFromServer.length > 0) {
        setAlertsQueue(prev => [...prev, ...newAlertsFromServer]);
        await AsyncStorage.setItem('seenAlertIds', JSON.stringify(Array.from(seenIds)));
      }
    } catch (e) {
      console.warn("Erro ao sincronizar Timeline:", e);
    }
  }, []);

  // 2. Conexão WebSocket
  const connect = useCallback(() => {
    setConnectionStatus("Conectando...");

    ws.current = new WsConnection(WEBSOCKET_URL, {
      onOpen: () => {
        setConnectionStatus("Conectado");
        syncTimeline();
        const appInfo = { 
          type: "DEVICE_STATUS", 
          deviceId: `App_${user?.name?.replace(/\s/g, '_') || 'Mobile'}`, 
          status: "online" 
        };
        ws.current?.ws?.send(JSON.stringify(appInfo));
      },
      onMessage: (event) => {
        try {
          const data = JSON.parse(event.data);
          const devId = data.deviceId || data.dispositivo;
          if (!devId) return;

          if (data.type === "DEVICE_STATUS") {
            setDevicesById(prev => ({
              ...prev,
              [devId]: {
                ...(prev[devId] || { deviceId: devId }),
                status: data.status,
                connected: data.status === "online",
                lastSeen: Date.now(),
                uptimeSec: data.uptimeSec,
                tempCpu: data.tempCpu,
                heapB: data.heapB,
                rssiDbm: data.rssiDbm,
                ip: data.ip
              }
            }));
          }

          if (data.type === "ALERTA") {
            setAlertsQueue(prev => [...prev, {
              id: `ws-${Date.now()}-${devId}`,
              deviceId: devId,
              type: data.sub_type,
              message: data.message || `${data.sub_type} em ${data.detalhes?.local || 'Local'}`,
              timestamp: Date.now()
            }]);
          }
        } catch (e) { console.error("Erro WS:", e); }
      },
      onClose: () => setConnectionStatus("Desconectado"),
      onError: () => setConnectionStatus("Erro"),
    });
  }, [user, syncTimeline]);

  // 3. Funções de Filtro (NECESSÁRIAS PARA O DASHBOARD)
  const getDevicesByType = useCallback((type) => {
    return Object.values(devicesById).filter(d => d.deviceType === type);
  }, [devicesById]);

  const getNewDevices = useCallback(() => {
    return Object.values(devicesById).filter(d => 
      !d.deviceType && 
      d.connected && 
      !d.deviceId.toLowerCase().includes('servidor')
    );
  }, [devicesById]);

  // 4. Ações
  const acknowledgeAlert = async (alertId, deviceId, type) => {
    try {
      const params = new URLSearchParams();
      params.append('id', alertId);
      params.append('user', user?.name || "App_User");

      await fetch(`${SERVER_HTTP_BASE}/acknowledge`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: params.toString()
      });

      setAlertsQueue(prev => prev.filter(a => a.id !== alertId));
      setDevicesById(prev => ({
        ...prev,
        [deviceId]: { ...prev[deviceId], lastAlertType: undefined }
      }));
    } catch (e) { console.error("Erro ACK:", e); }
  };

  const updateDeviceType = async (deviceId, newType) => {
    try {
      const body = new URLSearchParams();
      body.append('deviceId', deviceId);
      if (newType) {
        body.append('type', newType);
        await fetch(`${SERVER_HTTP_BASE}/devices/set`, { method: 'POST', body });
      } else {
        await fetch(`${SERVER_HTTP_BASE}/devices/delete`, { method: 'POST', body });
      }
      setDevicesById(prev => ({
        ...prev,
        [deviceId]: { ...prev[deviceId], deviceType: newType }
      }));
    } catch (e) { console.error("Erro Update Type:", e); }
  };

  const requestSystemBroadcast = () => {
    if (ws.current?.ws?.readyState === 1) {
      ws.current.ws.send(JSON.stringify({
        type: "COMANDO", target: "BROADCAST_ALL", payload: { type: "REQUEST_STATUS" }
      }));
    }
  };

  useEffect(() => {
    if (user) connect();
    return () => ws.current?.ws?.close();
  }, [user, connect]);

  useEffect(() => {
    setActiveAlert(alertsQueue.length > 0 ? alertsQueue[0] : null);
  }, [alertsQueue]);

  // --- VALUE COMPLETO ---
  return (
    <AlertsContext.Provider value={{
      connectionStatus,
      devicesById,
      alertsQueue,
      activeAlert,
      acknowledgeAlert,
      dismissActiveAlert: () => setAlertsQueue(prev => prev.slice(1)),
      updateDeviceType,
      removeDevice: async (id) => setDevicesById(prev => {
        const copy = {...prev}; delete copy[id]; return copy;
      }),
      requestSystemBroadcast,
      getDevicesByType, // <-- Crucial
      getNewDevices     // <-- Crucial
    }}>
      {children}
    </AlertsContext.Provider>
  );
};