const FIFTEEN_SECONDS = 15000;
const TWO_SECONDS = 2000;

type WsHandlers = {
  onOpen?: (event: Event) => void;
  onMessage?: (event: MessageEvent) => void;
  onClose?: (event: CloseEvent) => void;
  onError?: (event: Event) => void;
};

export class WsConnection {
  public ws: WebSocket;
  private heartbeatTimeout?: NodeJS.Timeout;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private reconnectDelay = TWO_SECONDS;
  private url: string;
  private handlers: WsHandlers;

  constructor(url: string, handlers: WsHandlers = {}) {
    this.url = url;
    this.handlers = handlers;
    this.ws = this.createWebSocket();
  }

  private createWebSocket(): WebSocket {
    const ws = new WebSocket(this.url);

    ws.onopen = (event) => {
      console.log("✅ WebSocket conectado.");
      this.reconnectAttempts = 0;
      this.resetHeartbeat();
      if (this.handlers.onOpen) {
        this.handlers.onOpen(event);
      }
    };

    ws.onmessage = (event) => {
      
      this.resetHeartbeat();
      if (this.handlers.onMessage) {
        console.info(event.data);
        this.handlers.onMessage(event);
      }
    };

    ws.onclose = (event) => {
      console.log("🔌 WebSocket desconectado.");
      if (this.handlers.onClose) {
        this.handlers.onClose(event);
      }
      this.reconnectAttempts++;
      if (this.reconnectAttempts < this.maxReconnectAttempts) {
        setTimeout(
          () => {
            this.ws = this.createWebSocket();
          },
          this.reconnectDelay * Math.pow(2, this.reconnectAttempts)
        );
      } else {
        console.log("Limite de tentativas de reconexão atingido.");
      }
    };

    ws.onerror = (event) => {
      console.error("Erro no WebSocket:", event);
      if (this.handlers.onError) {
        this.handlers.onError(event);
      }
      ws.close();
    };

    return ws;
  }

  private resetHeartbeat() {
    if (this.heartbeatTimeout) {
      clearTimeout(this.heartbeatTimeout);
    }
    this.heartbeatTimeout = setTimeout(() => {
      console.log("Heartbeat timeout! Conexão perdida.");
      this.ws.close();
    }, FIFTEEN_SECONDS);
  }
}
