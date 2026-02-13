import { View, Text, StyleSheet, StatusBar, TouchableOpacity, ScrollView, Modal, Alert, TextInput, ActivityIndicator } from 'react-native';
import { useMemo, useState, useEffect, useRef, useLayoutEffect } from 'react';
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
    triggerVirtualPanic,
    getDeviceTypesList,
  } = useAlerts();

  const [typeSelectorVisible, setTypeSelectorVisible] = useState(false);
  const [selectedDeviceId, setSelectedDeviceId] = useState(null);
  const [serverExpanded, setServerExpanded] = useState(false);
  const theme = useMemo(() => getTheme(themeName), [themeName]);
  const styles = useMemo(() => createStyles(theme), [theme]);
  const groupedDevices = getDevicesByType();
  const newDevices = getNewDevices();
  // Detecta o dispositivo do servidor central por nome (servidor/server)
  const serverDevice = useMemo(() => {
    if (!devicesById) return null;

    return Object.values(devicesById).find(d =>
      d.deviceType === 'servidor' ||
      d.deviceType === 'server' ||
      d.deviceType === 'central'
    );

  }, [devicesById]);

  // Modal de desconexão do servidor
  const [showDisconnectModal, setShowDisconnectModal] = useState(false);

  // --- [NOVO V51] Estado do Modal de Acessibilidade (Pânico) ---
  const [panicModalVisible, setPanicModalVisible] = useState(false);

  const prevStatusRef = useRef(connectionStatus);

  // --- LÓGICA DE SENHA PARA CONFIGURAÇÕES ---
  const [passwordModalVisible, setPasswordModalVisible] = useState(false);
  const [passwordInput, setPasswordInput] = useState('');

  const handleSettingsPress = () => {
    navigation.navigate('Settings', { user });
  };

  // Configura o botão de engrenagem no topo direito
  useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        // O onPress agora sempre apontará para a versão mais recente de handleSettingsPress
        <TouchableOpacity onPress={handleSettingsPress} style={{ marginRight: 15 }}>
          <Ionicons name="settings-outline" size={24} color={theme.colors.text} />
        </TouchableOpacity>
      ),
    });
    // --- [CORREÇÃO REACT] Adicionado 'user' e 'handleSettingsPress' nas dependências ---
    // Isso força o botão a ser recriado quando o usuário for carregado/autenticado.
  }, [navigation, theme, user, handleSettingsPress]);

  // --- FASE 4.2 (Visual Clássico Restaurado): Botão Colorido ---
  const renderAutomationSection = () => {
    if (!devicesById) return null;

    // 1. Filtra apenas dispositivos que são "ATUADORES"
    const actuators = Object.values(devicesById).filter(device => {
      const typeConfig = deviceTypes[device.deviceType];
      return typeConfig && typeConfig.capability === 'atuador';
    });

    if (actuators.length === 0) return null;

    return (
      <>
        {actuators.map(device => {
          const gateState = device.gateState;

          const isSyncing = connectionStatus !== 'Conectado' || !device.connected;

          // Lógica Visual Original (Cores e Ícones)
          let buttonStyle = {};
          let text = "Acionar";
          let icon = "key-outline";
          let stateLabel = "Estado Desconhecido";

          // Mapeamento idêntico ao MainScreen (14)
          switch (gateState) {
            case 'FECHADO':
            case 'CLOSED':
              text = "Portão Fechado";
              buttonStyle = { backgroundColor: '#22c55e' }; // Verde
              icon = "lock-closed-outline";
              stateLabel = "Estado do Portão";
              break;
            case 'ABERTO':
            case 'OPEN':
              buttonStyle = { backgroundColor: '#ef4444' }; // Vermelho
              text = "Portão Aberto";
              icon = "lock-open-outline";
              stateLabel = "Estado do Portão";
              break;
            case 'EM_MOVIMENTO':
            case 'MOVING':
              buttonStyle = { backgroundColor: '#f59e0b' }; // Amarelo
              text = "Movendo...";
              icon = "swap-horizontal-outline";
              stateLabel = "Operando";
              break;
            case 'ACIONADO':
            case 'TRIGGERED':
              buttonStyle = { backgroundColor: '#6b7280' }; // Cinza
              text = "Acionado";
              icon = "hourglass-outline";
              stateLabel = "Aguarde";
              break;
            default:
              // Fallback para status desconhecido/offline
              buttonStyle = { backgroundColor: '#6b7280' }; // Cinza
              text = "Sincronizando...";
              icon = "cloud-download-outline";
              stateLabel = "Conectando";
              break;
          }

          // Função de Ação (Com Confirmação igual ao antigo)
          const handlePress = () => {
            console.log(`[UI] Disparando TRIGGER direto para ${device.deviceId}`);
            enviarComando(device.deviceId, 'TRIGGER');
          }

          return (
            <View key={device.deviceId} style={styles.categoryContainer}>
              <TouchableOpacity
                style={[styles.categoryButton, buttonStyle]}
                onPress={handlePress}
                activeOpacity={0.8}
                disabled={isSyncing && !gateState}
              >
                {isSyncing && (
                  <View style={styles.syncIndicator}>
                    <ActivityIndicator size="small" color="#ffffff" />
                  </View>
                )}
                <Text style={styles.gateStateText}>{stateLabel}</Text>
                <Ionicons name={icon} size={48} color="#ffffff" style={styles.categoryIcon} />
                <Text style={styles.gateButtonText}>{text}</Text>
              </TouchableOpacity>
            </View>
          );
        })}
      </>
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

  // FASE 5: Consumindo o Objeto Agrupado (groupedDevices)
  const pulseiraDevices = groupedDevices['pulseira'] || [];

  const detectorDevices = [
    ...(groupedDevices['barreira'] || []),
    ...(groupedDevices['microondas'] || []),
    ...(groupedDevices['detector'] || [])
  ];

  const sensorDevices = (groupedDevices['gas_fumaca'] || []).filter(d => d.deviceId !== 'SENSOR_GAS_FUMACA');

  const automacaoDevices = groupedDevices['automacao'] || [];

  const handleRemoveType = async (deviceId) => {
    await updateDeviceType(deviceId, undefined);
  };

  const renderDeviceCard = (device) => {
    const isAdmin = user?.role === 'admin';
    // CORREÇÃO: Acessamos direto pela chave (muito mais rápido)
    const deviceType = deviceTypes[device.deviceType];
    // Ajuste: O objeto agora usa 'label' em vez de 'name', mas vamos garantir compatibilidade
    const typeConfig = deviceType
      ? { name: deviceType.name, color: deviceType.color }
      : { name: "Sem tipo", color: "#6b7280" };

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
                // Bloqueia a opacidade se tiver alerta OU se não for admin
                (isAlertActive || !isAdmin) && styles.buttonDisabled
              ]}
              // Só abre o modal de seleção de tipo se for Admin
              onPress={() => isAdmin && !isAlertActive && showTypeSelector(device.deviceId)}
              disabled={isAlertActive || !isAdmin}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Text style={styles.typeButtonText}>{typeConfig.name}</Text>
            </TouchableOpacity>

            {/* Oculta o botão de remover completamente para não-admins */}
            {hasType && isAdmin && (
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
                Tempo ligado: {Math.floor(device.uptimeSec / 3600)}h {Math.floor((device.uptimeSec % 3600) / 60)}m
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
                Atualizado há {Math.max(0, Math.floor((Date.now() - device.lastSeen) / 1000))}s
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
    const bgColor = status?.bg || theme.colors.card;
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
    // 1. CENÁRIO: NENHUM SERVIDOR CONFIGURADO
    if (!serverDevice) {
      // PROGRAMAÇÃO DEFENSIVA: Se o app ainda está tentando conectar, 
      // mostramos um estado neutro de "Localizando" em vez de um erro crítico.
      if (connectionStatus === 'Conectando...') {
        return (
          <View style={[styles.serverCard, { borderColor: theme.colors.border, borderWidth: 1 }]}>
            <View style={[styles.serverHeaderRow, { justifyContent: 'flex-start' }]}>
              <Ionicons name="sync-outline" size={36} color={theme.colors.muted} style={{ marginRight: 12 }} />
              <View>
                <Text style={[styles.serverHeader, { color: theme.colors.text }]}>Localizando Servidor...</Text>
                <Text style={[styles.deviceInfoText, { color: theme.colors.textSecondary, fontSize: 12 }]}>
                  Sincronizando dispositivos na rede
                </Text>
              </View>
            </View>
          </View>
        );
      }

      // Se não está "Conectando" e mesmo assim não há serverDevice, exibe o Alerta Vermelho
      return (
        <View style={[styles.serverCard, { borderColor: '#ef4444', borderWidth: 1, backgroundColor: 'rgba(239, 68, 68, 0.1)' }]}>
          <View style={[styles.serverHeaderRow, { justifyContent: 'flex-start' }]}>
            <Ionicons name="alert-circle" size={36} color="#ef4444" style={{ marginRight: 12 }} />
            <View>
              <Text style={[styles.serverHeader, { color: '#ef4444' }]}>Servidor Ausente</Text>
              <Text style={[styles.deviceInfoText, { color: theme.colors.textSecondary, fontSize: 12 }]}>
                Selecione o tipo "Servidor" na lista abaixo
              </Text>
            </View>
          </View>
        </View>
      );
    }

    // 2. CENÁRIO: SERVIDOR ENCONTRADO (Card Padrão com Métricas)
    const statusText = connectionStatus;
    // Lógica Tripla: Verde (Online) | Cinza (Carregando - Silent) | Vermelho (Offline)
    const statusColor = connectionStatus === 'Conectado'
      ? '#22c55e'
      : connectionStatus === 'Conectando...'
        ? '#9ca3af' // <--- CINZA (Status Neutro)
        : '#ef4444';
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
                Uptime: {Math.floor(serverDevice.uptimeSec / 3600)}h {Math.floor((serverDevice.uptimeSec % 3600) / 60)}m
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
                Atualizado há {Math.max(0, Math.floor((Date.now() - serverDevice.lastSeen) / 1000))}s
              </Text>
            )}
            {typeof serverDevice?.ip === 'string' && serverDevice.ip.length > 0 && (
              <Text style={[styles.deviceInfoText, styles.serverMetricText]}>IP: {serverDevice.ip}</Text>
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
      setPanicModalVisible(true);
    };

    return (
      <View style={styles.containerelderly}>
        {renderAutomationSection()}
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

  // --- [NOVO V51] Renderização do Modal de Acessibilidade ---
  const renderPanicAccessibilityModal = () => (
    <Modal
      visible={panicModalVisible}
      transparent
      animationType="slide"
      onRequestClose={() => setPanicModalVisible(false)}
    >
      <View style={styles.accOverlay}>
        <View style={styles.accContainer}>
          <Ionicons name="warning" size={80} color={theme.colors.danger} style={{ marginBottom: 20 }} />

          <Text style={styles.accTitle}>PEDIR SOCORRO?</Text>
          <Text style={styles.accMessage}>
            Isso enviará um alerta de emergência para todos os familiares.
          </Text>

          <View style={styles.accButtonsContainer}>
            {/* Botão CANCELAR (Vermelho - Solicitado) */}
            <TouchableOpacity
              style={[styles.accButton, { backgroundColor: '#ef4444' }]}
              onPress={() => setPanicModalVisible(false)}
              activeOpacity={0.8}
            >
              <Ionicons name="close-circle-outline" size={40} color="#fff" />
              <Text style={styles.accButtonText}>CANCELAR</Text>
            </TouchableOpacity>

            {/* Botão CONFIRMAR (Verde - Solicitado) */}
            <TouchableOpacity
              style={[styles.accButton, { backgroundColor: '#22c55e' }]}
              onPress={() => {
                setPanicModalVisible(false);
                triggerVirtualPanic();
              }}
              activeOpacity={0.8}
            >
              <Ionicons name="checkmark-circle-outline" size={40} color="#fff" />
              <Text style={styles.accButtonText}>SIM, SOCORRO!</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );

  return (
    <View style={styles.container}>
      <StatusBar barStyle={themeName === 'light' ? 'dark-content' : 'light-content'} />
      <ConnectionStatusBanner status={connectionStatus} />

      {/* --- [INSERÇÃO] Injetando o Modal na Árvore de Visualização --- */}
      {renderPanicAccessibilityModal()}
      {/* ------------------------------------------------------------- */}

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={user?.role === 'elderly' ? styles.elderlyScrollContent : styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {user?.role === 'elderly' ? (
          renderElderlyMode()
        ) : (
          <>
            {renderServerCard()}
            {renderAutomationSection()}
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
                try { requestSystemBroadcast?.(); } catch (e) { }
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
        deviceTypes={getDeviceTypesList()}
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
    borderRadius: 9999,
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

  // --- ESTILOS VISUAIS RESTAURADOS (VERSÃO CLÁSSICA) ---
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
  syncIndicator: {
    position: 'absolute',
    top: 15,
    right: 15,
    backgroundColor: 'rgba(0,0,0,0.2)', // Fundo levemente escuro para contraste
    borderRadius: 20,
    padding: 4,
    zIndex: 10,
  },

  // Estilos Específicos do Portão (Texto Grande e Branco)
  gateStateText: {
    color: 'rgba(255, 255, 255, 0.9)',
    fontSize: 13,
    fontWeight: '600',
    letterSpacing: 0.5,
    textAlign: 'center',
    marginBottom: 5,
  },
  gateButtonText: {
    color: '#ffffff', // Garante BRANCO
    fontSize: 20,     // Garante GRANDE
    fontWeight: 'bold', // Garante NEGRITO
    letterSpacing: 1,
    textAlign: 'center',
    marginTop: 5,
  },

  // --- RESTANTE DOS ESTILOS ---
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
  passwordInput: {
    backgroundColor: theme.colors.background,
    color: theme.colors.text,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: 8,
    padding: 10,
    fontSize: 18,
    textAlign: 'center',
    marginBottom: 15,
    width: '100%',
    letterSpacing: 5,
  },
  sectionContainer: {
    width: '100%',
    alignItems: 'center',
  },
  sectionTitle: {
    ...typography.h3,
    color: theme.colors.text,
    marginBottom: 10,
    marginLeft: 4,
    alignSelf: 'flex-start',
    width: '90%',
    maxWidth: 400,
  },
  accOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.9)', // Fundo bem escuro para foco total
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  accContainer: {
    width: '100%',
    backgroundColor: theme.colors.card,
    borderRadius: 20,
    padding: 30,
    alignItems: 'center',
    borderWidth: 2,
    borderColor: theme.colors.border,
    elevation: 10,
  },
  accTitle: {
    fontSize: 32, // Fonte Gigante
    fontWeight: '900',
    color: theme.colors.text,
    textAlign: 'center',
    marginBottom: 10,
    textTransform: 'uppercase',
  },
  accMessage: {
    fontSize: 20, // Fonte Grande para leitura fácil
    color: theme.colors.textSecondary,
    textAlign: 'center',
    marginBottom: 40,
    lineHeight: 28,
  },
  accButtonsContainer: {
    width: '100%',
    gap: 20, // Espaço entre botões para evitar toque acidental
  },
  accButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 25, // Altura do botão aumentada
    borderRadius: 16,
    width: '100%',
    elevation: 5,
    gap: 15,
  },
  accButtonText: {
    color: '#ffffff',
    fontSize: 24, // Texto do botão gigante
    fontWeight: 'bold',
    letterSpacing: 1,
  },
});