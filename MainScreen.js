import { View, Text, StyleSheet, StatusBar, TouchableOpacity, ScrollView } from 'react-native';
import { useMemo, useState } from 'react';
import { Ionicons } from '@expo/vector-icons';
import { useAlerts } from './AlertsContext';
import { ConnectionStatusBanner } from './ConnectionStatusBanner';
import DeviceTypeSelector from './DeviceTypeSelector';
import { getTheme, typography } from './theme';

export default function MainScreen({ navigation, user, themeName = 'dark' }) {
  const {
    connectionStatus,
    sensorState,
    deviceTypes,
    updateDeviceType,
    getDevicesByType,
    getNewDevices,
    acknowledgeAlert,
    activeAlert,
    dismissActiveAlert,
  } = useAlerts();

  const [typeSelectorVisible, setTypeSelectorVisible] = useState(false);
  const [selectedDeviceId, setSelectedDeviceId] = useState(null);
  const theme = useMemo(() => getTheme(themeName), [themeName]);
  const styles = useMemo(() => createStyles(theme), [theme]);

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
  const sensorDevices = getDevicesByType('gas_fumaca').filter(d => d.deviceId !== 'SENSOR_GAS_FUMACA');
  const newDevices = getNewDevices();

  const handleRemoveType = async (deviceId) => {
    await updateDeviceType(deviceId, undefined);
  };

  const getAlertCount = (devices) => {
    return devices.filter(device => device.lastAlertType).length;
  };

  const renderDeviceCard = (device) => {
    const deviceType = deviceTypes.find(t => t.id === device.deviceType);
    const typeConfig = deviceType || { name: "Sem tipo", color: "#6b7280" };
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
        onPress={isAlertActive ? () => acknowledgeAlert(device.deviceId, device.lastAlertType) : undefined}
        activeOpacity={0.8}
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
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Text style={styles.typeButtonText}>{typeConfig.name}</Text>
            </TouchableOpacity>
            {hasType && (
              <TouchableOpacity 
                style={[styles.removeButton, isAlertActive && styles.buttonDisabled]}
                onPress={() => !isAlertActive && handleRemoveType(device.deviceId)}
                disabled={isAlertActive}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Text style={styles.removeButtonText}>Remover Tipo</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
        <Text style={[styles.subStatus, { color: alertStatusColor }]}>
          {alertStatusText}
        </Text>
        {isAlertActive && !!device.lastAlertAt && (
          <Text style={styles.deviceInfoText}>
            Notificado: {new Date(device.lastAlertAt).toLocaleString()}
          </Text>
        )}
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
            {typeof device.lastSeen === 'number' && device.lastSeen > 0 && (
              <Text style={styles.deviceInfoText}>
                Atualizado há {Math.max(0, Math.floor((Date.now() - device.lastSeen)/1000))}s
              </Text>
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

<<<<<<< HEAD
  const renderCategoryButton = (title, iconName, devices, categoryKey, status, prependText) => {
=======
  const renderCategoryButton = (title, icon, devices, categoryKey, status, prependText) => {
>>>>>>> parent of ace65bc (updates)
    // status: { text: string | null, bg: string | null }
    const bgColor = status?.bg || '#2d3748';
    const statusText = status?.text || null;

    return (
      <View style={styles.categoryContainer}>
        <TouchableOpacity 
          style={[styles.categoryButton, { backgroundColor: bgColor }]}
          onPress={() => navigation.navigate('CategoryDevices', {
            categoryTitle: title,
            categoryIcon: iconName,
            categoryKey: categoryKey,
          })}
          activeOpacity={0.7}
        >
          <View style={styles.categoryContent}>
            {prependText && (
              <Text style={styles.categoryStatus}>{prependText}</Text>
            )}
            <Ionicons
              name={iconName}
              size={48}
              color={theme.colors.primary}
              style={styles.categoryIcon}
            />
            <Text style={styles.categoryTitle}>{title}</Text>
            {statusText && (
              <Text style={styles.categoryStatus}>{statusText}</Text>
            )}
          </View>
        </TouchableOpacity>
      </View>
    );
  };
  
  return (
    <View style={styles.container}>
      <StatusBar barStyle={themeName === 'light' ? 'dark-content' : 'light-content'} />
      <ConnectionStatusBanner status={connectionStatus} />

      <ScrollView 
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {newDevices.length > 0 && (
          <View style={styles.newDevicesSection}>
            <View style={styles.newDevicesHeaderRow}>
              <Ionicons
                name="construct-outline"
                size={24}
                color={theme.colors.primary}
                style={styles.newDevicesIcon}
              />
              <Text style={styles.newDevicesHeader}>Dispositivos Novos</Text>
            </View>
            <Text style={styles.newDevicesSubtitle}>
              Estes dispositivos precisam ter o tipo definido
            </Text>
            {renderDeviceGroup(newDevices)}
          </View>
        )}

        {renderCategoryButton(
          'Sensores de Gás e Fumaça',
          'flame-outline',
          sensorDevices,
          'sensores',
          (() => {
            // Verde e mensagem "Ambiente Seguro" quando NÃO há alerta ativo
            if (sensorState === 'Vazamento de Gás') {
              return { text: 'Gás Detectado', bg: '#7f1d1d' };
            }
            if (sensorState === 'Fumaça Detectada') {
              return { text: 'Fumaça Detectada', bg: '#7f1d1d' };
            }
            // Qualquer outro estado: considerar seguro
            return { text: null, bg: null };
          })(),
          (sensorState === 'Vazamento de Gás' || sensorState === 'Fumaça Detectada') ? null : 'Ambiente Seguro'
        )}
        {renderCategoryButton(
          'Pulseiras Assistivas',
          'watch-outline',
          pulseiraDevices,
          'pulseira',
          (() => {
            const hasPanic = pulseiraDevices.some(d => d.lastAlertType === 'PANICO');
            return hasPanic ? { text: 'Socorro Solicitado', bg: '#7f1d1d' } : { text: null, bg: null };
          })()
        )}
        {renderCategoryButton(
          'Detectores de Queda',
          'body-outline',
          detectorDevices,
          'detector',
          (() => {
            const hasFall = detectorDevices.some(d => d.lastAlertType === 'QUEDA');
            return hasFall ? { text: 'Queda Detectada', bg: '#7f1d1d' } : { text: null, bg: null };
          })()
        )}
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

const createStyles = (theme) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.colors.background,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: 20,
    paddingBottom: 40,
    alignItems: 'center',
    flexGrow: 1,
    justifyContent: 'center',
  },
  newDevicesSection: {
    backgroundColor: theme.colors.card,
    borderRadius: 12,
    padding: 20,
    width: '90%',
    maxWidth: 400,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  newDevicesHeader: {
    ...typography.h3,
    color: theme.colors.text,
    marginBottom: 5,
  },
  newDevicesHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
  },
  newDevicesIcon: {
    marginTop: 2,
  },
  newDevicesSubtitle: {
    ...typography.small,
    color: theme.colors.muted,
    marginBottom: 10,
    fontStyle: 'italic',
  },
  categoryContainer: {
    width: '90%',
    maxWidth: 400,
    marginBottom: 20,
  },
  categoryButton: {
    backgroundColor: theme.colors.card,
    borderRadius: 16,
    padding: 25,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: theme.name === 'light' ? 0.15 : 0.3,
    shadowRadius: 8,
    elevation: 8,
    position: 'relative',
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  categoryContent: {
    alignItems: 'center',
  },
  categoryIcon: {
    marginBottom: 12,
  },
  categoryTitle: {
    ...typography.h3,
    color: theme.colors.text,
    textAlign: 'center',
  },
  categoryStatus: {
    ...typography.smallStrong,
    color: theme.colors.textSecondary,
    marginTop: 6,
    textAlign: 'center',
  },
  alertBadge: {
    position: 'absolute',
    top: 10,
    right: 10,
    backgroundColor: theme.colors.danger,
    borderRadius: 12,
    minWidth: 24,
    height: 24,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 6,
  },
  alertBadgeText: {
    color: theme.colors.text,
    fontSize: 12,
    fontWeight: 'bold',
  },
  devicesContainer: {
    marginTop: 15,
    backgroundColor: theme.colors.card,
    borderRadius: 12,
    padding: 15,
  },
  deviceHeader: {
    flexDirection: 'row',
    backgroundColor: theme.colors.card,
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
    paddingBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
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
    backgroundColor: theme.colors.primary,
  },
  typeButtonText: {
    color: theme.name === 'light' ? '#ffffff' : theme.colors.text,
    fontSize: 12,
    fontWeight: 'bold',
    textAlign: 'center',
  },
  removeButton: {
    backgroundColor: theme.colors.danger,
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
    backgroundColor: theme.colors.card,
    borderRadius: 10,
    padding: 16,
    marginTop: 10,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  subTitle: {
    ...typography.h3,
    color: theme.colors.text,
    flex: 1,
    marginRight: 8,
  },
  subStatus: {
    marginTop: 6,
    ...typography.smallStrong,
  },
  deviceInfoBlock: {
    marginTop: 12,
    gap: 5,
  },
  deviceInfoText: {
    ...typography.small,
    color: theme.colors.muted,
  },
  cardPanicActive: {
    borderWidth: 2,
    borderColor: theme.colors.danger,
    backgroundColor: theme.name === 'light' ? '#fee2e2' : '#331111',
  },
  cardFallActive: {
    borderWidth: 2,
    borderColor: theme.colors.warning,
    backgroundColor: theme.name === 'light' ? '#fef3c7' : '#3b2f0a',
  },
  ackHint: {
    marginTop: 8,
    ...typography.smallStrong,
  },
  alertOverlay: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    padding: 16,
    backgroundColor: theme.colors.overlay,
  },
  alertBox: {
    backgroundColor: theme.colors.card,
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  alertTitle: {
    ...typography.h3,
    color: theme.colors.text,
    marginBottom: 6,
  },
  alertMessage: {
    ...typography.body,
    color: theme.colors.textSecondary,
    marginBottom: 12,
  },
  alertButton: {
    alignSelf: 'flex-end',
    backgroundColor: theme.colors.primary,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
  },
  alertButtonText: {
    color: '#ffffff',
    fontWeight: 'bold',
    fontSize: 14,
  },
});
