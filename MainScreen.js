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
    acknowledgeAlert,
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
  const detectorDevices = [...getDevicesByType('barreira'), ...getDevicesByType('microondas'), ...getDevicesByType('detector')];
  const sensorDevices = getDevicesByType('outros');
  const newDevices = getNewDevices();

  const handleRemoveType = async (deviceId) => {
    await updateDeviceType(deviceId, undefined);
  };

  const getAlertCount = (devices) => {
    return devices.filter(device => device.lastAlertType).length;
  };

  const renderDeviceCard = (device) => {
    const deviceType = deviceTypes.find(t => t.id === device.deviceType);
    const typeConfig = deviceType || { name: "Sem tipo", color: "#6b7280", icon: "❓" };
    const hasType = !!device.deviceType;

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
      >
        <View style={styles.deviceHeader}>
          <Text style={styles.subTitle} numberOfLines={1} ellipsizeMode="tail">{device.deviceId}</Text>
          <View style={styles.typeButtonsContainer}>
            <TouchableOpacity 
              style={[
                styles.typeButton, 
                { backgroundColor: typeConfig.color },
                isAlertActive && styles.buttonDisabled
              ]}
              onPress={() => !isAlertActive && showTypeSelector(device.deviceId)}
              disabled={isAlertActive}
            >
              <Text style={styles.typeButtonText}>{typeConfig.name}</Text>
            </TouchableOpacity>
            {hasType && (
              <TouchableOpacity 
                style={[styles.removeButton, isAlertActive && styles.buttonDisabled]}
                onPress={() => !isAlertActive && handleRemoveType(device.deviceId)}
                disabled={isAlertActive}
              >
                <Text style={styles.removeButtonText}>Remover Tipo</Text>
              </TouchableOpacity>
            )}
          </View>
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
                Tempo ligado: {Math.floor(device.uptimeSec/3600)}h {Math.floor((device.uptimeSec%3600)/60)}m
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
  };

  const renderCategoryButton = (title, icon, devices, categoryKey) => {
    const alertCount = getAlertCount(devices);

    return (
      <View style={styles.categoryContainer}>
        <TouchableOpacity 
          style={styles.categoryButton}
          onPress={() => navigation.navigate('CategoryDevices', {
            categoryTitle: title,
            categoryIcon: icon,
            categoryKey: categoryKey,
          })}
          activeOpacity={0.7}
        >
          <View style={styles.categoryContent}>
            <Text style={styles.categoryIcon}>{icon}</Text>
            <Text style={styles.categoryTitle}>{title}</Text>
            {devices.length > 0 && (
              <Text style={styles.categoryCount}>({devices.length})</Text>
            )}
          </View>
          {alertCount > 0 && (
            <View style={styles.alertBadge}>
              <Text style={styles.alertBadgeText}>{alertCount}</Text>
            </View>
          )}
        </TouchableOpacity>
      </View>
    );
  };
  
  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" />
      <ConnectionStatusBanner status={connectionStatus} />

      <ScrollView 
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {newDevices.length > 0 && (
          <View style={styles.newDevicesSection}>
            <Text style={styles.newDevicesHeader}>🔧 Dispositivos Novos</Text>
            <Text style={styles.newDevicesSubtitle}>
              Estes dispositivos precisam ter o tipo definido
            </Text>
            {renderDeviceGroup(newDevices)}
          </View>
        )}

        {renderCategoryButton('Sensores de Gás e Fumaça', '🛡️', sensorDevices, 'sensores')}
        {renderCategoryButton('Pulseiras Assistivas', '⌚', pulseiraDevices, 'pulseira')}
        {renderCategoryButton('Detectores de Queda', '📱', detectorDevices, 'detector')}

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
    backgroundColor: '#7a8a99',
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: 20,
    paddingBottom: 40,
    alignItems: 'center',
  },
  newDevicesSection: {
    backgroundColor: '#1f2937',
    borderRadius: 12,
    padding: 20,
    width: '90%',
    maxWidth: 400,
    marginBottom: 20,
  },
  newDevicesHeader: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#f9fafb',
    marginBottom: 5,
  },
  newDevicesSubtitle: {
    fontSize: 13,
    color: '#9ca3af',
    marginBottom: 10,
    fontStyle: 'italic',
  },
  categoryContainer: {
    width: '90%',
    maxWidth: 400,
    marginBottom: 20,
  },
  categoryButton: {
    backgroundColor: '#2d3748',
    borderRadius: 16,
    padding: 25,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
    position: 'relative',
  },
  categoryContent: {
    alignItems: 'center',
  },
  categoryIcon: {
    fontSize: 50,
    marginBottom: 12,
  },
  categoryTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#ffffff',
    textAlign: 'center',
  },
  categoryCount: {
    fontSize: 14,
    color: '#9ca3af',
    marginTop: 4,
  },
  alertBadge: {
    position: 'absolute',
    top: 10,
    right: 10,
    backgroundColor: '#ef4444',
    borderRadius: 12,
    minWidth: 24,
    height: 24,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 6,
  },
  alertBadgeText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: 'bold',
  },
  devicesContainer: {
    marginTop: 15,
    backgroundColor: '#1f2937',
    borderRadius: 12,
    padding: 15,
  },
  deviceHeader: {
    flexDirection: 'row',
    backgroundColor: '#0e76a8',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  typeButtonsContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
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
  removeButton: {
    backgroundColor: '#ef4444',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
  },
  removeButtonText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: 'bold',
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  subCard: {
    backgroundColor: '#111827',
    borderRadius: 10,
    padding: 16,
    marginTop: 10,
    borderWidth: 2,
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
  cardPanicActive: {
    borderWidth: 3,
    borderColor: '#ef4444',
    backgroundColor: '#331111',
  },
  cardFallActive: {
    borderWidth: 3,
    borderColor: '#f59e0b',
    backgroundColor: '#3b2f0a',
  },
  ackHint: {
    marginTop: 8,
    fontSize: 12,
    fontWeight: 'bold',
  },
});
