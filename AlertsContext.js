import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { Alert } from 'react-native';

const WEBSOCKET_URL = 'ws://e482f364dbe8.ngrok-free.app/ws';
const API_URL = 'https://e482f364dbe8.ngrok-free.app';

const HEARTBEAT_TIMEOUT = 15000;
const RECONNECT_DELAY_BASE = 2000;
const MAX_RECONNECT_ATTEMPTS = 5;

const AlertsContext = createContext();

export function useAlerts() {
  return useContext(AlertsContext);
}

export const AlertsProvider = ({ children, user }) => {
  const [connectionStatus, setConnectionStatus] = useState('Desconectado');
  const [sensorState, setSensorState] = useState('Servidor Desconectado');
  const [buttonState, setButtonState] = useState('Desconectado');
  const [fallState, setFallState] = useState('Servidor Desconectado');
  const [activeAlert, setActiveAlert] = useState(null);
  const [allAlerts, setAllAlerts] = useState([]);

  const ws = useRef(null);
  const heartbeatTimeoutRef = useRef(null);
  const reconnectAttempts = useRef(0);

  const connect = useCallback(() => {
    console.log(`Tentando conectar... (tentativa ${reconnectAttempts.current + 1})`);
    setConnectionStatus('Conectando...');
    const socket = new WebSocket(WEBSOCKET_URL);
    ws.current = socket;

    const resetHeartbeat = () => {
      clearTimeout(heartbeatTimeoutRef.current);
      heartbeatTimeoutRef.current = setTimeout(() => {
        console.log('Heartbeat timeout! Conexão perdida.');
        setConnectionStatus('Desconectado');
        setSensorState('Servidor Desconectado');
        setButtonState('Desconectado');
        setFallState('Servidor Desconectado');
        ws.current?.close();
      }, HEARTBEAT_TIMEOUT);
    };

    socket.onopen = () => {
      console.log('✅ WebSocket conectado.');
      setConnectionStatus('Conectado');
      reconnectAttempts.current = 0;
      resetHeartbeat();
    };

    socket.onmessage = (event) => {
      resetHeartbeat();
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'ping') return;

        // Handle alert updates
        if (data.type === 'new_alert' || data.type === 'alert_acknowledged') {
          console.log(`Received ${data.type}, refreshing alerts...`);
          fetchAlerts();
        }

        if (data.type === 'sensor' && data.tipo) {
          setSensorState(data.tipo);
        } else if (data.type === 'botao' && data.status) {
          setButtonState(data.status);
        } else if (data.type === 'queda' && data.status) {
          setFallState(data.status);
        }
      } catch (error) {
        console.error('Erro ao processar mensagem:', error);
      }
    };

    socket.onclose = () => {
      console.log('🔌 WebSocket desconectado.');
      clearTimeout(heartbeatTimeoutRef.current);
      setConnectionStatus('Desconectado');
      setSensorState('Servidor Desconectado');
      setButtonState('Desconectado');
      setFallState('Servidor Desconectado');

      if (reconnectAttempts.current < MAX_RECONNECT_ATTEMPTS) {
        const delay = RECONNECT_DELAY_BASE * Math.pow(2, reconnectAttempts.current);
        setTimeout(connect, delay);
        reconnectAttempts.current++;
      } else {
        console.log('Limite de tentativas de reconexão atingido.');
      }
    };

    socket.onerror = (e) => {
      console.error('Erro no WebSocket:', e.message);
      setConnectionStatus('Erro');
      socket.close();
    };
  }, []);

  useEffect(() => {
    if (user) {
      connect();
    }
    return () => {
      reconnectAttempts.current = MAX_RECONNECT_ATTEMPTS; // Impede a reconexão ao desmontar
      ws.current?.close();
    };
  }, [user, connect]);

  // Efeito para gerenciar a exibição de alertas modais
  useEffect(() => {
    if (buttonState === 'Apertado') {
      setActiveAlert({ title: 'Botão de Pânico Acionado', message: 'O botão de pânico foi pressionado. Verifique a situação imediatamente.' });
    } else if (fallState === 'Queda Detectada') {
      setActiveAlert({ title: 'Alerta de Queda', message: 'Uma possível queda foi detectada.' });
    } else if (sensorState === 'Gás e Fumaça Detectados') {
      setActiveAlert({ title: 'Alerta de Gás e Fumaça', message: 'Níveis perigosos de gás e fumaça foram detectados.' });
    } else if (sensorState === 'Fumaça Detectada') {
      setActiveAlert({ title: 'Alerta de Fumaça', message: 'Fumaça foi detectada no ambiente.' });
    } else if (sensorState === 'Vazamento de Gás') {
      setActiveAlert({ title: 'Alerta de Gás', message: 'Um vazamento de gás foi detectado.' });
    }
  }, [sensorState, buttonState, fallState]);

  const dismissActiveAlert = () => {
    setActiveAlert(null);
    // Força a reavaliação do estado dos botões/sensores após dispensar o alerta
    // Isso garante que se o estado já normalizou, a UI reflita isso.
    // A lógica do `useWebSocket` já deve ter atualizado os estados,
    // então apenas fechar o modal fará com que a UI seja re-renderizada com os valores mais recentes.
  };

  const fetchAlerts = useCallback(async () => {
    try {
      const response = await fetch(`${API_URL}/alerts`);
      if (!response.ok) throw new Error('Falha na resposta do servidor.');
      const data = await response.json();
      setAllAlerts(data);
    } catch (error) {
      Alert.alert('Erro', 'Não foi possível buscar os alertas.');
      setAllAlerts([]);
    }
  }, []);

  const acknowledgeAlertInList = async (id) => {
    if (!user) {
        Alert.alert('Erro', 'Você precisa estar logado para confirmar um alerta.');
        return;
    }
    try {
      const response = await fetch(`${API_URL}/acknowledge`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `id=${id}&user=${user.name}`
      });
      const result = await response.json();
      if (result.status === 'success') {
        Alert.alert('Sucesso', 'Alerta confirmado.');
        // A atualização agora é tratada pelo WebSocket
      } else {
        throw new Error(result.message || 'Falha ao confirmar.');
      }
    } catch (error) {
      Alert.alert('Erro', error.message);
    }
  };

  const value = {
    connectionStatus,
    sensorState,
    buttonState,
    fallState,
    activeAlert,
    dismissActiveAlert,
    allAlerts,
    fetchAlerts,
    acknowledgeAlertInList,
  };

  return <AlertsContext.Provider value={value}>{children}</AlertsContext.Provider>;
};