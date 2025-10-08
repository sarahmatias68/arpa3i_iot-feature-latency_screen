import { View, Text, StyleSheet, StatusBar, TouchableOpacity, ScrollView } from 'react-native';
import { useState } from 'react';
import { useAlerts } from './AlertsContext';
import { ConnectionStatusBanner } from './ConnectionStatusBanner';
import DeviceTypeSelector from './DeviceTypeSelector';

export default function MainScreen({ navigation, user }) {
  const {
    connectionStatus,
    sensorState,
    deviceTypes,
    updateDeviceType,
    getDevicesByType,
    getNewDevices,
    acknowledgeAlert, // <<-- Usando a nova função unificada
  } = useAlerts();

  const [typeSelectorVisible, setTypeSelectorVisible] = useState(false);
  const [selectedDeviceId, setSelectedDeviceId] = useState(null);

  const getColorForSensorState = (state) => {
    switch (state) {
      case 'Ambiente Seguro': return '#22c55e';
      case 'Vazamento de Gás': return '#facc15';
      case 'Fumaça Detectada': return '#ef4444';
      default: return '#6b7280';
    }
  };

  const getBatteryColor = (battery) => {
    if (battery == null) return '#6b7280';
    if (battery <= 2800) return '#ef4444';
    if (battery <= 3600) return '#facc15';
    return '#22c55e';
  };

  const pulseiraDevices = getDevicesByType('pulseira');
  const barreiraDevices = getDevicesByType('barreira');
  const detectorDevices = getDevicesByType('detector');
  const microondasDevices = getDevicesByType('microondas');
  const outrosDevices = getDevicesByType('outros');
  const newDevices = getNewDevices();

  const renderDeviceCard = (device) => {
    const deviceType = deviceTypes.find(t => t.id === device.deviceType);
    const typeConfig = deviceType || { name: "Sem tipo", color: "#6b7280", icon: "❓" };

    const statusText = device.connected ? 'Online' : 'Offline';
    const statusColor = device.connected ? '#22c55e' : '#6b7280';
    
    // <<-- CORREÇÃO: Lógica unificada para qualquer tipo de alerta -->>
    const isAlertActive = !!device.lastAlertType;
    const alertStyle = 
        device.lastAlertType === 'PANICO' ? styles.cardPanicActive :
        device.lastAlertType === 'QUEDA' ? styles.cardFallActive : null;
    
    const alertStatusText = 
        device.lastAlertType === 'PANICO' ? 'BOTÃO ACIONADO' :
        device.lastAlertType === 'QUEDA' ? 'QUEDA DETECTADA' : statusText;

    const alertStatusColor = 
        device.lastAlertType === 'PANICO' ? '#ef4444' :
        device.lastAlertType === 'QUEDA' ? '#f59e0b' : statusColor;


    return (
      <TouchableOpacity 
        key={device.deviceId} 
        style={[styles.subCard, alertStyle]}
        // <<-- CORREÇÃO: Chama a função unificada ao tocar no card em alerta -->>
        onPress={isAlertActive ? () => acknowledgeAlert(device.deviceId, device.lastAlertType) : undefined}
        activeOpacity={isAlertActive ? 0.7 : 1}
      >
        <View style={styles.deviceHeader}>
          <Text style={styles.subTitle} numberOfLines={1} ellipsizeMode="tail">{device.deviceId}</Text>
          <TouchableOpacity 
            style={[styles.typeButton, { backgroundColor: typeConfig.color }]}
            onPress={() => showTypeSelector(device.deviceId)}
          >
            <Text style={styles.typeButtonText}>{typeConfig.icon} {typeConfig.name}</Text>
          </TouchableOpacity>
        </View>
        <Text style={[styles.subStatus, { color: alertStatusColor }]}>
          {alertStatusText}
        </Text>
        {device.connected && (
          <View style={styles.deviceInfoBlock}>
            {typeof device.batteryMv === 'number' && (
              <Text style={[styles.deviceInfoText, { color: getBatteryColor(device.batteryMv) }]}>
                Bateria: {device.batteryMv} mV
              </Text>
            )}
            {typeof device.uptimeSec === 'number' && (
              <Text style={styles.deviceInfoText}>
                Uptime: {Math.floor(device.uptimeSec/3600)}h {Math.floor((device.uptimeSec%3600)/60)}m
              </Text>
            )}
            {typeof device.rssiDbm === 'number' && (
              <Text style={styles.deviceInfoText}>WiFi: {device.rssiDbm} dBm</Text>
            )}
            {typeof device.tempCpuC === 'number' && (
              <Text style={styles.deviceInfoText}>CPU: {device.tempCpuC}°C</Text>
            )}
            {typeof device.heapB === 'number' && (
              <Text style={styles.deviceInfoText}>Heap: {device.heapB} B</Text>
            )}
            {device.reconnects !== undefined && (
              <Text style={styles.deviceInfoText}>Reconexões: {device.reconnects}</Text>
            )}
          </View>
        )}
        {isAlertActive && (
          <Text style={[styles.ackHint, { color: alertStatusColor }]}>Toque para marcar como ciente</Text>
        )}
      </TouchableOpacity>
    );
  };

  const showTypeSelector = (deviceId) => {
    setSelectedDeviceId(deviceId);
    setTypeSelectorVisible(true);
  };

  const handleTypeSelection = async (typeId) => {
    if (selectedDeviceId) {
      await updateDeviceType(selectedDeviceId, typeId);
    }
    setTypeSelectorVisible(false);
    setSelectedDeviceId(null);
  };

  const renderDeviceGroup = (devices) => {
    if (devices.length === 0) return null;
    return devices.map(device => renderDeviceCard(device));
  }
  
  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" />
      <ConnectionStatusBanner status={connectionStatus} />

      <ScrollView 
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.card}>
          <Text style={styles.title}>Status do Ambiente</Text>
          <Text style={[styles.status, { color: getColorForSensorState(sensorState) }]}>
            {sensorState || 'Indisponível'}
          </Text>
        </View>

        {newDevices.length > 0 && (
          <View style={styles.cardSection}>
            <Text style={styles.sectionHeader}>🔧 Dispositivos Novos</Text>
            <Text style={styles.sectionSubtitle}>
              Estes dispositivos precisam ter o tipo definido
            </Text>
            {renderDeviceGroup(newDevices)}
          </View>
        )}
        
        {pulseiraDevices.length > 0 && (
          <View style={styles.cardSection}>
            <Text style={styles.sectionHeader}>Pulseiras Assistivas</Text>
            {renderDeviceGroup(pulseiraDevices)}
          </View>
        )}

        {detectorDevices.length > 0 && (
          <View style={styles.cardSection}>
            <Text style={styles.sectionHeader}>Detectores de Queda</Text>
            {renderDeviceGroup(detectorDevices)}
          </View>
        )}

        {barreiraDevices.length > 0 && (
          <View style={styles.cardSection}>
            <Text style={styles.sectionHeader}>Barreiras</Text>
            {renderDeviceGroup(barreiraDevices)}
          </View>
        )}
        
        {microondasDevices.length > 0 && (
          <View style={styles.cardSection}>
            <Text style={styles.sectionHeader}>Micro-ondas</Text>
            {renderDeviceGroup(microondasDevices)}
          </View>
        )}

        {outrosDevices.length > 0 && (
          <View style={styles.cardSection}>
            <Text style={styles.sectionHeader}>Outros Dispositivos</Text>
            {renderDeviceGroup(outrosDevices)}
          </View>
        )}

        <TouchableOpacity style={styles.logsButton} onPress={() => navigation.navigate('History', { user: user })}>
          <Text style={styles.logsButtonText}>Histórico de Registros</Text>
        </TouchableOpacity>

      </ScrollView>

      <DeviceTypeSelector
        visible={typeSelectorVisible}
        onClose={() => setTypeSelectorVisible(false)}
        onSelectType={handleTypeSelection}
        deviceTypes={deviceTypes}
        deviceId={selectedDeviceId}
      />
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
    padding: 20,
    paddingBottom: 40,
  },
  card: {
    backgroundColor: '#1f2937',
    borderRadius: 12,
    padding: 25,
    width: '100%',
    alignItems: 'center',
    marginBottom: 20,
  },
  cardSection: {
    backgroundColor: '#1f2937',
    borderRadius: 12,
    padding: 20,
    width: '100%',
    marginBottom: 20,
  },
  sectionHeader: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#f9fafb',
    marginBottom: 5,
  },
  sectionSubtitle: {
    fontSize: 14,
    color: '#9ca3af',
    marginBottom: 10,
    fontStyle: 'italic',
  },
  deviceHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  typeButton: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
  },
  typeButtonText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: 'bold',
    textAlign: 'center',
  },
  subCard: {
    backgroundColor: '#111827',
    borderRadius: 10,
    padding: 16,
    marginTop: 10,
    borderWidth: 1,
    borderColor: '#374151',
  },
  subTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#f3f4f6',
    flex: 1,
    marginRight: 8,
  },
  subStatus: {
    marginTop: 6,
    fontSize: 14,
    fontWeight: 'bold',
  },
  deviceInfoBlock: {
    marginTop: 12,
    gap: 5,
  },
  deviceInfoText: {
    fontSize: 13,
    color: '#d1d5db',
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
  cardPanicActive: {
    borderWidth: 2,
    borderColor: '#ef4444',
    backgroundColor: '#331111',
  },
  // <<-- NOVO ESTILO PARA QUEDA -->>
  cardFallActive: {
    borderWidth: 2,
    borderColor: '#f59e0b', // Laranja
    backgroundColor: '#3b2f0a',
  },
  ackHint: {
    marginTop: 8,
    fontSize: 12,
    fontWeight: 'bold',
  },
  logsButton: {
    backgroundColor: '#3b82f6',
    paddingVertical: 15,
    paddingHorizontal: 30,
    borderRadius: 10,
    marginTop: 10,
  },
  logsButtonText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: 'bold',
    textAlign: 'center',
  },
});

