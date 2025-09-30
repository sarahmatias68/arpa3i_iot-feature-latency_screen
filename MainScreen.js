import { View, Text, StyleSheet, StatusBar, Modal, TouchableOpacity } from 'react-native';
import { useAlerts } from './AlertsContext';
import { ConnectionStatusBanner } from './ConnectionStatusBanner';

export default function MainScreen({ navigation, user }) {
  const {
    connectionStatus,
    sensorState,
    buttonState,
    fallState,
    activeAlert,
    dismissActiveAlert,
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
      case 'Nenhuma Queda': return '#22c55e'; // Verde
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

      <TouchableOpacity style={styles.logsButton} onPress={() => navigation.navigate('History', { user: user })}>
        <Text style={styles.logsButtonText}>Histórico de Registros</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#111827',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 20,
    padding: 20,
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
  // ... (o resto dos seus estilos continua igual)
});