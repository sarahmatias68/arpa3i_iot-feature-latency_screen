import { useEffect, useState, useRef, useCallback } from 'react';

const HEARTBEAT_TIMEOUT = 15000;
const RECONNECT_DELAY_BASE = 2000;
const MAX_RECONNECT_ATTEMPTS = 5;

export default function useWebSocket(url) {
  const [connectionStatus, setConnectionStatus] = useState('Desconectado');
  const [sensorState, setSensorState] = useState('Indisponível');
  const [buttonState, setButtonState] = useState('Indisponível');
  const [fallState, setFallState] = useState('Indisponível');
  const [metricsState, setMetricsState] = useState({
    ram: { free: 0, total: 0 },
    sd: { used: 0, total: 0 },
    latency: { avg: 0, min: 0, max: 0 },
  });
  const ws = useRef(null);
  const heartbeatTimeoutRef = useRef(null);
  const reconnectAttempts = useRef(0);

  const connect = useCallback(() => {
    console.log(`Tentando conectar... (tentativa ${reconnectAttempts.current + 1})`);
    setConnectionStatus('Conectando...');
    const socket = new WebSocket(url);
    ws.current = socket;

    const resetHeartbeat = () => {
      clearTimeout(heartbeatTimeoutRef.current);
      heartbeatTimeoutRef.current = setTimeout(() => {
        console.log('Heartbeat timeout! Conexão perdida.');
        setConnectionStatus('Desconectado');
        setSensorState('Indisponível');
        setButtonState('Indisponível');
        setFallState('Indisponível');
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

        if (data.type === 'sensor' && data.tipo) {
          setSensorState(data.tipo);
        } else if (data.type === 'botao' && data.status) {
          setButtonState(data.status);
        } else if (data.type === 'queda' && data.status) {
          setFallState(data.status);
        } else if (data.type === 'metrics') {
          setMetricsState(data);
        }
      } catch (error) {
        console.error('Erro ao processar mensagem:', error);
      }
    };

    socket.onclose = () => {
      console.log('🔌 WebSocket desconectado.');
      clearTimeout(heartbeatTimeoutRef.current);
      setConnectionStatus('Desconectado');
      setSensorState('Indisponível');
      setButtonState('Indisponível');
      setFallState('Indisponível');
      setMetricsState({
        ram: { free: 0, total: 0 },
        sd: { used: 0, total: 0 },
        latency: { avg: 0, min: 0, max: 0 },
      });

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
      socket.close();
    };
  }, [url]);

  useEffect(() => {
    connect();
    return () => {
      reconnectAttempts.current = MAX_RECONNECT_ATTEMPTS;
      ws.current?.close();
    };
  }, [connect]);

  return { connectionStatus, sensorState, buttonState, fallState, metricsState };
}
