import React, { useMemo, useState, useEffect, useRef } from 'react';
import { View, Text, StyleSheet, StatusBar, TouchableOpacity, ScrollView, Modal } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAlerts } from './AlertsContext'; // SERVER_DEVICE_PATTERN agora deve estar dentro do Context
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
    devicesById,
    requestSystemBroadcast,
  } = useAlerts();

  const [typeSelectorVisible, setTypeSelectorVisible] = useState(false);
  const [selectedDeviceId, setSelectedDeviceId] = useState(null);
  const [serverExpanded, setServerExpanded] = useState(false);
  const theme = useMemo(() => getTheme(themeName), [themeName]);
  const styles = useMemo(() => createStyles(theme), [theme]);

  // Identifica o Servidor Central (v48 usa nomes contendo 'servidor' ou 'server')
  const serverDevice = useMemo(() => {
    if (!devicesById) return null;
    return Object.values(devicesById).find(d => 
      d.deviceId.toLowerCase().includes('servidor') || 
      d.deviceId.toLowerCase().includes('server')
    );
  }, [devicesById]);

  // Lógica de cores para Bateria (mV)
  const getBatteryColor = (battery) => {
    if (!battery) return '#6b7280';
    if (battery <= 3300) return '#ef4444'; // Crítico
    if (battery <= 3700) return '#facc15'; // Alerta
    return '#22c55e'; // OK
  };

  // Agrupamento de Dispositivos
  const pulseiraDevices = getDevicesByType('pulseira');
  const detectorDevices = [
    ...getDevicesByType('barreira'), 
    ...getDevicesByType('microondas'), 
    ...getDevicesByType('detector')
  ];
  const sensorDevices = getDevicesByType('gas_fumaca');
  const newDevices = getNewDevices();

  // Renderização de um Card de Dispositivo Individual
  const renderDeviceCard = (device) => {
    const typeConfig = deviceTypes.find(t => t.id === device.deviceType) || { name: "Sem tipo", color: "#6b7280" };
    const isAlertActive = !!device.lastAlertType;

    return (
      <TouchableOpacity 
        key={device.deviceId} 
        style={[
          styles.subCard, 
          isAlertActive && (device.lastAlertType === 'PANICO' ? styles.cardPanicActive : styles.cardFallActive)
        ]}
        onPress={isAlertActive ? () => acknowledgeAlert("app_ack", device.deviceId, device.lastAlertType) : null}
      >
        <View style={styles.deviceHeader}>
          <Text style={styles.subTitle}>{device.deviceId}</Text>
          <TouchableOpacity 
            style={[styles.typeButton, { backgroundColor: typeConfig.color }]}
            onPress={() => setTypeSelectorVisible(true) || setSelectedDeviceId(device.deviceId)}
          >
            <Text style={styles.typeButtonText}>{typeConfig.name}</Text>
          </TouchableOpacity>
        </View>

        <Text style={[styles.subStatus, { color: device.connected ? '#22c55e' : '#ef4444' }]}>
          {isAlertActive ? `⚠️ ${device.lastAlertType}` : (device.connected ? 'Online' : 'Offline')}
        </Text>

        {device.connected && (
          <View style={styles.deviceInfoBlock}>
            {device.batteryMv && (
              <Text style={[styles.deviceInfoText, { color: getBatteryColor(device.batteryMv) }]}>
                Bateria: {device.batteryMv}mV
              </Text>
            )}
            {device.rssiDbm && <Text style={styles.deviceInfoText}>Wi-Fi: {device.rssiDbm}dBm</Text>}
            {device.tempCpu && <Text style={styles.deviceInfoText}>CPU: {device.tempCpu}°C</Text>}
          </View>
        )}
      </TouchableOpacity>
    );
  };

  return (
    <View style={styles.container}>
      <StatusBar barStyle={themeName === 'light' ? 'dark-content' : 'light-content'} />
      <ConnectionStatusBanner status={connectionStatus} />

      <ScrollView contentContainerStyle={styles.scrollContent}>
        
        {/* CARD DO SERVIDOR CENTRAL */}
        <TouchableOpacity 
          style={styles.serverCard} 
          onPress={() => setServerExpanded(!serverExpanded)}
        >
          <View style={styles.serverHeaderRow}>
            <Ionicons name="server-outline" size={32} color={theme.colors.primary} />
            <View>
              <Text style={styles.serverHeader}>Servidor Central Arpa3i</Text>
              <Text style={[styles.serverStatus, { color: connectionStatus === 'Conectado' ? '#22c55e' : '#ef4444' }]}>
                {connectionStatus}
              </Text>
            </View>
          </View>

          {serverExpanded && serverDevice && (
            <View style={styles.serverMetricsBlock}>
              <Text style={styles.deviceInfoText}>CPU: {serverDevice.tempCpu}°C</Text>
              <Text style={styles.deviceInfoText}>Memória: {Math.round(serverDevice.heapB / 1024)} KB livre</Text>
              <Text style={styles.deviceInfoText}>IP: {serverDevice.ip}</Text>
              <Text style={styles.deviceInfoText}>Sinal: {serverDevice.rssiDbm} dBm</Text>
            </View>
          )}
        </TouchableOpacity>

        {/* SEÇÃO DE NOVOS DISPOSITIVOS */}
        {newDevices.length > 0 && (
          <View style={styles.newDevicesSection}>
            <Text style={styles.newDevicesHeader}>🆕 Novos Dispositivos</Text>
            {newDevices.map(renderDeviceCard)}
          </View>
        )}

        {/* BOTÕES DE CATEGORIA */}
        <View style={styles.grid}>
          {renderCategoryButton('Gás e Fumaça', 'flame-outline', sensorState !== 'Ambiente Seguro', 'sensores')}
          {renderCategoryButton('Pulseiras', 'watch-outline', pulseiraDevices.some(d => d.lastAlertType), 'pulseira')}
          {renderCategoryButton('Quedas', 'body-outline', detectorDevices.some(d => d.lastAlertType), 'detector')}
        </View>

      </ScrollView>

      <DeviceTypeSelector
        visible={typeSelectorVisible}
        onClose={() => setTypeSelectorVisible(false)}
        onSelectType={async (type) => {
          await updateDeviceType(selectedDeviceId, type);
          setTypeSelectorVisible(false);
        }}
        deviceTypes={deviceTypes}
      />
    </View>
  );

  // Helper para os botões grandes de categoria
  function renderCategoryButton(title, icon, isAlert, categoryKey) {
    return (
      <TouchableOpacity 
        style={[styles.categoryButton, isAlert && { backgroundColor: '#7f1d1d' }]}
        onPress={() => navigation.navigate('CategoryDevices', { categoryKey, title })}
      >
        <Ionicons name={icon} size={40} color={isAlert ? '#fff' : theme.colors.primary} />
        <Text style={[styles.categoryTitle, isAlert && { color: '#fff' }]}>{title}</Text>
        {isAlert && <Text style={styles.alertTextAnim}>VERIFICAR AGORA</Text>}
      </TouchableOpacity>
    );
  }
}
const createStyles = (theme) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.colors.background,
  },
  scrollContent: {
    padding: 20,
    paddingBottom: 40,
    alignItems: 'center',
  },
  serverCard: {
    backgroundColor: theme.colors.card,
    borderRadius: 16,
    padding: 20,
    width: '100%',
    marginBottom: 20,
    borderWidth: 1,
    borderColor: theme.colors.border,
    elevation: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
  },
  serverHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 15,
  },
  serverHeader: {
    ...typography.h3,
    color: theme.colors.text,
  },
  serverStatus: {
    ...typography.smallStrong,
    marginTop: 2,
  },
  serverMetricsBlock: {
    marginTop: 15,
    paddingTop: 15,
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
    gap: 8,
  },
  newDevicesSection: {
    width: '100%',
    marginBottom: 25,
  },
  newDevicesHeader: {
    ...typography.h3,
    color: theme.colors.primary,
    marginBottom: 10,
  },
  grid: {
    width: '100%',
    gap: 15,
  },
  categoryButton: {
    backgroundColor: theme.colors.card,
    borderRadius: 16,
    padding: 20,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: theme.colors.border,
    minHeight: 140,
  },
  categoryTitle: {
    ...typography.h3,
    color: theme.colors.text,
    marginTop: 10,
  },
  alertTextAnim: {
    color: '#fff',
    fontWeight: 'bold',
    fontSize: 12,
    marginTop: 8,
    backgroundColor: 'rgba(0,0,0,0.3)',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 20,
  },
  subCard: {
    backgroundColor: theme.colors.card,
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  deviceHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  subTitle: {
    ...typography.bodyStrong,
    color: theme.colors.text,
    flex: 1,
  },
  typeButton: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 6,
  },
  typeButtonText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: 'bold',
  },
  subStatus: {
    ...typography.smallStrong,
    marginBottom: 8,
  },
  deviceInfoBlock: {
    gap: 4,
  },
  deviceInfoText: {
    ...typography.small,
    color: theme.colors.textSecondary,
  },
  cardPanicActive: {
    borderColor: '#ef4444',
    borderWidth: 2,
    backgroundColor: theme.name === 'dark' ? '#451a1a' : '#fee2e2',
  },
  cardFallActive: {
    borderColor: '#f59e0b',
    borderWidth: 2,
    backgroundColor: theme.name === 'dark' ? '#45301a' : '#fef3c7',
  },
  alertOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  alertBox: {
    backgroundColor: theme.colors.card,
    borderRadius: 20,
    padding: 25,
    width: '100%',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  alertTitle: {
    ...typography.h2,
    color: theme.colors.text,
    marginBottom: 10,
  },
  alertMessage: {
    ...typography.body,
    color: theme.colors.textSecondary,
    textAlign: 'center',
    marginBottom: 20,
  },
  alertButton: {
    backgroundColor: theme.colors.primary,
    paddingHorizontal: 30,
    paddingVertical: 12,
    borderRadius: 10,
  },
  alertButtonText: {
    color: '#fff',
    fontWeight: 'bold',
  },
});
// ... (Estilos mantidos e otimizados para Dark Theme)