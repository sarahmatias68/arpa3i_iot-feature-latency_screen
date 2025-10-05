import { View, Text, StyleSheet, StatusBar, Modal, TouchableOpacity, ScrollView } from 'react-native';
import { useAlerts } from './AlertsContext';
import { ConnectionStatusBanner } from './ConnectionStatusBanner';
import AlertStatusCard from './AlertStatusCard';

export default function MainScreen({ navigation, user }) {
  const {
    connectionStatus,
    sensorState,
    buttonState,
    fallState,
    activeAlert,
    dismissActiveAlert,
    devices,
    sendDeviceId,
  } = useAlerts();

  const getColorForSensorState = (state) => {
    switch (state) {
      case 'Ambiente Seguro': return '#22c55e';
      case 'Vazamento de Gás': return '#facc15';
      case 'Fumaça Detectada': return '#ef4444';
      default: return '#6b7280';
    }
  };

  const getColorForButtonState = (state) => {
    switch (state) {
      case 'Apertado': return '#ef4444';
      case 'Conectado': return '#22c55e';
      default: return '#6b7280';
    }
  };

  // FUNÇÃO DE COR ATUALIZADA
  const getColorForFallState = (state) => {
    if (typeof state === 'object' && state.status === 'Queda Detectada') {
      return '#ef4444'; // Vermelho
    }
    switch (state) {
      case 'Conectado': return '#22c55e'; // Verde
      default: return '#6b7280'; // Cinza (para "Desconectado")
    }
  };

  // NOVA FUNÇÃO PARA RENDERIZAR O TEXTO
  const renderFallStatus = () => {
    if (typeof fallState === 'object' && fallState !== null) {
      return `Queda: ${fallState.dispositivo} (${fallState.comodo})`;
    }
    return fallState;
  };

  // Função para renderizar dispositivos conectados
  const renderDeviceCard = (device) => {
    const getDeviceColor = (status) => {
      switch (status) {
        case 'online': return '#22c55e';
        case 'offline': return '#ef4444';
        default: return '#6b7280';
      }
    };

    const formatUptime = (uptime) => {
      if (!uptime) return 'N/A';
      const hours = Math.floor(uptime / 3600);
      const minutes = Math.floor((uptime % 3600) / 60);
      return `${hours}h ${minutes}m`;
    };

    const getBatteryColor = (battery) => {
      if (!battery) return '#6b7280';
      if (battery < 3200) return '#ef4444';
      if (battery < 3600) return '#facc15';
      return '#22c55e';
    };

    return (
      <View key={device.deviceId} style={styles.deviceCard}>
        <View style={styles.deviceHeader}>
          <Text style={styles.deviceTitle}>{device.deviceId}</Text>
          <View style={[styles.deviceStatus, { backgroundColor: getDeviceColor(device.status) }]}>
            <Text style={styles.deviceStatusText}>
              {device.status === 'online' ? 'ONLINE' : 'OFFLINE'}
            </Text>
          </View>
        </View>
        
        {device.status === 'online' && (
          <View style={styles.deviceInfo}>
            {device.uptime && (
              <Text style={styles.deviceInfoText}>
                ⏱️ Uptime: {formatUptime(device.uptime)}
              </Text>
            )}
            {device.battery && (
              <Text style={[styles.deviceInfoText, { color: getBatteryColor(device.battery) }]}>
                🔋 Bateria: {device.battery}mV
              </Text>
            )}
            {device.temperature && (
              <Text style={styles.deviceInfoText}>
                🌡️ Temp: {device.temperature.toFixed(1)}°C
              </Text>
            )}
            {device.rssi && (
              <Text style={styles.deviceInfoText}>
                📶 WiFi: {device.rssi}dBm
              </Text>
            )}
            {device.reconnects !== undefined && (
              <Text style={styles.deviceInfoText}>
                🔄 Reconexões: {device.reconnects}
              </Text>
            )}
          </View>
        )}
      </View>
    );
  };

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" />
      <ConnectionStatusBanner status={connectionStatus} />

      {activeAlert && (
        <Modal
          transparent={true}
          animationType="fade"
          visible={Boolean(activeAlert)}
          onRequestClose={dismissActiveAlert}
        >
          <View style={styles.modalContainer}>
            <View style={styles.modalView}>
              <Text style={styles.modalTitle}>{activeAlert.title}</Text>
              <Text style={styles.modalText}>{activeAlert.message}</Text>
              <TouchableOpacity style={styles.modalButton} onPress={dismissActiveAlert}>
                <Text style={styles.modalButtonText}>OK, ESTOU CIENTE</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>
      )}

      <ScrollView 
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* CARD DE ALERTA ATIVO */}
        {activeAlert && (
          <AlertStatusCard 
            activeAlert={activeAlert} 
            onDismiss={dismissActiveAlert} 
          />
        )}

        <View style={styles.card}>
          <Text style={styles.title}>Status do Ambiente</Text>
          <Text style={[styles.status, { color: getColorForSensorState(sensorState) }]}>
            {sensorState}
          </Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.title}>Botão de Pânico</Text>
          <Text style={[styles.status, { color: getColorForButtonState(buttonState) }]}>
            {buttonState}
          </Text>
        </View>

        {/* CARD DO DETECTOR DE QUEDA ATUALIZADO */}
        <View style={styles.card}>
          <Text style={styles.title}>Detector de Queda</Text>
          <Text style={[styles.status, { color: getColorForFallState(fallState) }]}>
            {renderFallStatus()}
          </Text>
        </View>

        {/* CARDS DE DISPOSITIVOS CONECTADOS */}
        {devices.length > 0 && (
          <View style={styles.devicesSection}>
            <Text style={styles.sectionTitle}>Dispositivos Conectados</Text>
            {devices.map(renderDeviceCard)}
          </View>
        )}

        <TouchableOpacity style={styles.logsButton} onPress={() => navigation.navigate('History', { user: user })}>
          <Text style={styles.logsButtonText}>Histórico de Registros</Text>
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#111827',
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    alignItems: 'center',
    padding: 20,
    gap: 20,
  },
  card: {
    backgroundColor: '#1f2937',
    borderRadius: 12,
    padding: 25,
    width: '100%',
    alignItems: 'center',
  },
  title: {
    fontSize: 22,
    fontWeight: 'bold',
    color: '#f9fafb',
    marginBottom: 15,
  },
  status: {
    fontSize: 26,
    fontWeight: 'bold',
    textAlign: 'center',
  },
  // Novos estilos para dispositivos
  devicesSection: {
    width: '100%',
    marginTop: 10,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#f9fafb',
    marginBottom: 15,
    textAlign: 'center',
  },
  deviceCard: {
    backgroundColor: '#1f2937',
    borderRadius: 12,
    padding: 20,
    marginBottom: 15,
    borderWidth: 1,
    borderColor: '#374151',
  },
  deviceHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  deviceTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#f9fafb',
    flex: 1,
  },
  deviceStatus: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    marginLeft: 10,
  },
  deviceStatusText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: 'bold',
  },
  deviceInfo: {
    marginTop: 10,
  },
  deviceInfoText: {
    fontSize: 14,
    color: '#d1d5db',
    marginBottom: 5,
  },
  logsButton: {
    backgroundColor: '#3b82f6',
    paddingVertical: 15,
    paddingHorizontal: 30,
    borderRadius: 10,
    marginTop: 20,
  },
  logsButtonText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: 'bold',
    textAlign: 'center',
  },
  modalContainer: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.8)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  modalView: {
    backgroundColor: '#1f2937',
    borderRadius: 15,
    padding: 30,
    width: '100%',
    maxWidth: 400,
    alignItems: 'center',
  },
  modalTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#ef4444',
    marginBottom: 15,
    textAlign: 'center',
  },
  modalText: {
    fontSize: 16,
    color: '#f9fafb',
    marginBottom: 25,
    textAlign: 'center',
    lineHeight: 24,
  },
  modalButton: {
    backgroundColor: '#ef4444',
    paddingVertical: 15,
    paddingHorizontal: 30,
    borderRadius: 10,
  },
  modalButtonText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: 'bold',
  },
});