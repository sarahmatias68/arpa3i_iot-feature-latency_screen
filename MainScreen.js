import { View, Text, StyleSheet, StatusBar, TouchableOpacity, ScrollView, Modal, Alert } from 'react-native';
import { useMemo, useState, useEffect, useRef } from 'react';
import { Ionicons } from '@expo/vector-icons';
import { useAlerts, SERVER_DEVICE_PATTERN } from './AlertsContext';
import { ConnectionStatusBanner } from './ConnectionStatusBanner';
import DeviceTypeSelector from './DeviceTypeSelector';
import { getTheme, typography } from './theme';

export default function MainScreen({ navigation, user, themeName = 'dark', appMode }) {
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
    devicesById,
    requestSystemBroadcast,
    enviarComando,
  } = useAlerts();

  const [typeSelectorVisible, setTypeSelectorVisible] = useState(false);
  const [selectedDeviceId, setSelectedDeviceId] = useState(null);
  const [serverExpanded, setServerExpanded] = useState(false);
  const theme = useMemo(() => getTheme(themeName), [themeName]);
  const styles = useMemo(() => createStyles(theme), [theme]);

  // Detecta o dispositivo do servidor central por nome (servidor/server)
  const serverDevice = useMemo(() => {
    if (!devicesById) return null;
    const ids = Object.keys(devicesById);
    const matchId = ids.find(id => SERVER_DEVICE_PATTERN.test(id));
    return matchId ? devicesById[matchId] : null;
  }, [devicesById]);

  // Modal de desconexão do servidor
  const [showDisconnectModal, setShowDisconnectModal] = useState(false);



  const prevStatusRef = useRef(connectionStatus);
  useEffect(() => {
    if (prevStatusRef.current !== connectionStatus) {
      if (connectionStatus === 'Desconectado') {
        setShowDisconnectModal(true);
      } else if (connectionStatus === 'Conectado') {
        setShowDisconnectModal(false);
        
        // --- INÍCIO DO PROTOCOLO UNIVERSAL DE AUTOMAÇÃO ---
        console.log('Conexão estabelecida. Iniciando Handshake de Automação...');
        
        // 1. Solicita telemetria geral de todos os dispositivos
        requestSystemBroadcast();

        // 2. Itera sobre todos os dispositivos conhecidos para solicitar status de automação
        if (devicesById) {
          Object.values(devicesById).forEach(device => {
            // Verifica se é um dispositivo de automação ou um portão
            if (device.deviceType === 'automacao' || device.deviceId.startsWith('Portao')) {
              console.log(`Enviando GET_STATUS para o dispositivo de automação: ${device.deviceId}`);
              enviarComando(device.deviceId, 'GET_STATUS');
            }
          });
        }
        // --- FIM DO PROTOCOLO ---

      }
      prevStatusRef.current = connectionStatus;
    }
  }, [connectionStatus, devicesById, requestSystemBroadcast, enviarComando]); 


  // --- LÓGICA DO PORTÃO ---
  const TARGET_GATE_ID = 'Portao_6C0878'; // ID fixo do dispositivo do portão
  const gateDevice = devicesById[TARGET_GATE_ID];
  const gateState = gateDevice?.gateState;


  const handleGateAction = () => {
    const isOpening = (gateState === 'FECHADO');
    const alertText = isOpening ? 'abrir' : 'fechar';
    const alertTitle = isOpening ? 'ABRIR' : 'FECHAR';

    Alert.alert(
      `Confirmar Ação`,
      `Deseja realmente ${alertText} o portão?`,
      [
        { text: "Cancelar", style: "cancel" },
        { 
          text: alertTitle,
          onPress: () => {
            // O comando é sempre ABRIR, pois o motor funciona com pulso
            enviarComando(TARGET_GATE_ID, 'PORTAO_ABRIR');
          }
        }
      ]
    );
  };

  const renderGateButton = () => {
    let buttonStyle = styles.gateButton;
    let text = "Acionar portão";
    let icon = "key-outline";

    switch (gateState) {
      case 'FECHADO':
        text = "Portão Fechado";
        buttonStyle = [styles.gateButton, { backgroundColor: '#22c55e' }]; // Verde
        icon = "lock-closed-outline";
        break;
      case 'ABERTO':
        buttonStyle = [styles.gateButton, { backgroundColor: '#ef4444' }]; // Vermelho
        text = "Portão Aberto";
        icon = "lock-open-outline";
        break;
      case 'EM_MOVIMENTO':
        buttonStyle = [styles.gateButton, { backgroundColor: '#f59e0b' }]; // Amarelo
        text = "Movendo...";
        icon = "swap-horizontal-outline";
        break;
      case 'ACIONADO':
        buttonStyle = [styles.gateButton, { backgroundColor: '#6b7280' }]; // Cinza
        text = "Acionado";
        icon = "hourglass-outline";
        break;
      default: // undefined, null, ou outro estado -> Sincronizando
        buttonStyle = [styles.gateButton, { backgroundColor: '#6b7280' }]; // Cinza por padrão
        text = "Sincronizando...";
        icon = "cloud-download-outline";
        break;
    }

    return (
      <View style={styles.categoryContainer}>
        <TouchableOpacity 
          style={[styles.categoryButton, buttonStyle]} 
          onPress={handleGateAction}
          activeOpacity={0.8}
        >
          <Text style={styles.gateStateText}>Estado do Portão</Text>
          <Ionicons name={icon} size={48} color="#ffffff" style={styles.categoryIcon} />
          <Text style={styles.gateButtonText}>{text}</Text>
        </TouchableOpacity>
      </View>
    );
  };

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
  const automacaoDevices = getDevicesByType('automacao');
  const newDevices = getNewDevices();

  const handleRemoveType = async (deviceId) => {
    await updateDeviceType(deviceId, undefined);
  };

  const renderDeviceCard = (device) => {
    const deviceType = deviceTypes.find(t => t.id === device.deviceType);
    const typeConfig = deviceType || { name: "Sem tipo", color: "#6b7280" };
    const hasType = !!device.deviceType;

    const statusText = device.connected ? 'Online' : 'Offline';
    const statusColor = device.connected ? '#22c55e' : '#6b7280';
    
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
                <Text style={styles.removeButtonText}>Remover</Text>
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

  const renderCategoryButton = (title, iconName, devices, categoryKey, status, prependText) => {
    const bgColor = status?.bg || theme.colors.card ;
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
  
  const renderServerCard = () => {
    const statusText = connectionStatus;
    const statusColor = connectionStatus === 'Conectado' ? '#22c55e' : connectionStatus === 'Conectando...' ? '#facc15' : '#ef4444';

    return (
      <TouchableOpacity
        style={styles.serverCard}
        onPress={() => setServerExpanded(prev => !prev)}
        activeOpacity={0.85}
      >
        <View style={styles.serverHeaderRow}>
          <Ionicons name="server-outline" size={36} color={theme.colors.primary} style={styles.serverIcon} />
          <Text style={styles.serverHeader}>Servidor Central</Text>
          <Text style={[styles.serverStatus, { color: statusColor }]}>Status: {statusText}</Text>
        </View>

        {serverExpanded && (
          <View style={[styles.deviceInfoBlock, styles.serverMetricsBlock]}>
            {typeof serverDevice?.uptimeSec === 'number' && (
              <Text style={[styles.deviceInfoText, styles.serverMetricText]}>
                Uptime: {Math.floor(serverDevice.uptimeSec/3600)}h {Math.floor((serverDevice.uptimeSec%3600)/60)}m
              </Text>
            )}
            {typeof serverDevice?.heapB === 'number' && (
              <Text style={[styles.deviceInfoText, styles.serverMetricText]}>Heap: {serverDevice.heapB} B</Text>
            )}
            {typeof serverDevice?.tempCpuC === 'number' && (
              <Text style={[styles.deviceInfoText, styles.serverMetricText]}>CPU: {serverDevice.tempCpuC}°C</Text>
            )}
            {typeof serverDevice?.rssiDbm === 'number' && (
              <Text style={[styles.deviceInfoText, styles.serverMetricText]}>WiFi: {serverDevice.rssiDbm} dBm</Text>
            )}
            {typeof serverDevice?.reconnects === 'number' && (
              <Text style={[styles.deviceInfoText, styles.serverMetricText]}>Reconexões: {serverDevice.reconnects}</Text>
            )}
            {typeof serverDevice?.lastSeen === 'number' && serverDevice.lastSeen > 0 && (
              <Text style={[styles.deviceInfoText, styles.serverMetricText]}>
                Atualizado há {Math.max(0, Math.floor((Date.now() - serverDevice.lastSeen)/1000))}s
              </Text>
            )}
            {typeof serverDevice?.ip === 'string' && serverDevice.ip.length > 0 && (
              <Text style={[styles.deviceInfoText, styles.serverMetricText]}>IP: {serverDevice.ip}</Text>
            )}
            {!serverDevice && (
              <Text style={[styles.deviceInfoText, styles.serverMetricText]}>Nenhuma métrica disponível.</Text>
            )}
          </View>
        )}
      </TouchableOpacity>
    );
  };
  
  const renderElderlyMode = () => {
    // Encontra o primeiro dispositivo de pulseira para o botão de pânico
    const pulseiraDevice = pulseiraDevices.length > 0 ? pulseiraDevices[0] : null;

    const handlePanicPress = () => {
      if (!pulseiraDevice) {
        Alert.alert("Erro", "Nenhuma pulseira de pânico configurada.");
        return;
      }
      Alert.alert(
        "Confirmar Pânico",
        "Tem certeza de que deseja enviar um alerta de pânico?",
        [
          { text: "Cancelar", style: "cancel" },
          { 
            text: "SIM, SOCORRO!",
            onPress: () => enviarComando(pulseiraDevice.deviceId, 'PANICO'),
            style: "destructive"
          }
        ]
      );
    };

    return (
      <View style={styles.containerelderly}>
      {renderGateButton()}
        <TouchableOpacity 
          style={styles.panicButton} 
          onPress={handlePanicPress}
          activeOpacity={0.8}
        >
          <Ionicons name="pulse-outline" size={80} color="#ffffff" />
          <Text style={styles.panicButtonText}>PÂNICO</Text>
          <Text style={styles.panicButtonSubText}>Pressione em caso de emergência</Text>
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
        contentContainerStyle={appMode === 'elderly' ? styles.elderlyScrollContent : styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {appMode === 'elderly' ? (
          renderElderlyMode()
        ) : (
          <>
            {renderServerCard()}
            {renderGateButton()}
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
                if (sensorState === 'Vazamento de Gás') {
                  return { text: 'Gás Detectado', bg: '#7f1d1d' };
                }
                if (sensorState === 'Fumaça Detectada') {
                  return { text: 'Fumaça Detectada', bg: '#7f1d1d' };
                }
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
            {renderCategoryButton(
              'Automação',
              'build-outline',
              automacaoDevices,
              'automacao',
              (() => {
                return { text: null, bg: null };
              })()
            )}
          </>
        )}
      </ScrollView>

      {/* Modal de desconexão do servidor */}
      <Modal
        visible={showDisconnectModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowDisconnectModal(false)}
      >
        <View style={styles.alertOverlay}>
          <View style={styles.alertBox}>
            <Text style={styles.alertTitle}>Servidor desconectou</Text>
            <Text style={styles.alertMessage}>App indisponível no momento.</Text>
            <TouchableOpacity
              style={styles.alertButton}
              onPress={() => {
                setShowDisconnectModal(false);
                try { requestSystemBroadcast?.(); } catch (e) {}
              }}
            >
              <Text style={styles.alertButtonText}>OK</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

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
  elderlyScrollContent: {
    padding: 20,
    paddingBottom: 40,
    alignItems: 'center',
    flexGrow: 1,
    justifyContent: 'center',
    gap: 20,
  },
  containerelderly: {
    flex: 1,
    justifyContent: 'space-around',
    gap: 20,
    alignItems: 'center',
    width: '100%',
  },
  panicButton: {
    width: '60%',
    maxWidth: 220,
    minWidth: 220,     
    aspectRatio: 1,
    backgroundColor: theme.colors.danger,
    borderRadius: 9999, // Círculo
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
    marginBottom: 20,
    elevation: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    
  },
  panicButtonText: {
    color: '#ffffff',
    fontSize: 30,
    fontWeight: 'bold',
    letterSpacing: 2,
  },
  panicButtonSubText: {
    color: 'rgba(255, 255, 255, 0.9)',
    fontSize: 16,
    marginTop: 8,
    textAlign: 'center',
  },
  // --- ESTILOS DO BOTÃO DE PORTÃO REORGANIZADOS ---
  gateButton: {
    width: '100%', 
    paddingVertical: 20, // Padding vertical confortável
    alignItems: 'center',
    justifyContent: 'center',
    // Removed elevation/shadow duplicates since categoryButton handles it
  },
  gateContent: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8, // Espaçamento uniforme entre os elementos (Texto Topo, Ícone, Texto Botão)
  },
  gateButtonText: {
    color: '#ffffff',
    fontSize: 20,
    fontWeight: 'bold',
    letterSpacing: 1,
    textAlign: 'center',
  },
  gateStateText: {
    color: 'rgba(255, 255, 255, 0.9)',
    fontSize: 13,
    fontWeight: '600',
    letterSpacing: 0.5,
    textAlign: 'center',
    // Removido position: absolute para fluir na lista
  },
  gateIcon: {
    marginBottom: 0, // Reset de margens se houver global
  },
  // ----------------------------------
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
  serverCard: {
    backgroundColor: theme.colors.card,
    borderRadius: 12,
    padding: 20,
    width: '90%',
    maxWidth: 400,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  serverHeaderRow: {
    flexDirection: 'column',
    alignItems: 'center',
    gap: 10,
  },
  serverIcon: {
    marginBottom: 4,
  },
  serverHeader: {
    ...typography.h3,
    color: theme.colors.text,
    textAlign: 'center',
  },
  serverStatus: {
    ...typography.smallStrong,
    marginTop: 4,
    textAlign: 'center',
  },
  serverMetricsBlock: {
    alignItems: 'center',
  },
  serverMetricText: {
    textAlign: 'center',
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
    ...typography.body,
    color: theme.colors.muted,
    marginBottom: 10,
    fontWeight: 'bold',
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
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.2,
    shadowRadius: 1.41,
  },
  categoryContent: {
    alignItems: 'center',
    justifyContent: 'center',
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
    marginBottom: 5,
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
    marginBottom: 10,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  cardPanicActive: {
    backgroundColor: '#4c0519',
    borderColor: '#ef4444',
  },
  cardFallActive: {
    backgroundColor: '#4a2c0d',
    borderColor: '#f59e0b',
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
    marginBottom: 5,
  },
  deviceInfoBlock: {
    marginTop: 12,
    gap: 5,
  },
  deviceInfoText: {
    ...typography.small,
    color: theme.colors.muted,
    fontWeight: 'bold',
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
    paddingVertical: 10,
    paddingHorizontal: 20,
  },
  alertButtonText: {
    ...typography.button,
    color: '#ffffff',
    fontWeight: 'bold',
    fontSize: 14,
  },
});