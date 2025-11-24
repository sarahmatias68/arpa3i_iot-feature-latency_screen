import { useState, useEffect } from "react";
import { TouchableOpacity } from "react-native";
// IMPORTAÇÃO MODIFICADA
import {
  NavigationContainer,
  useNavigationContainerRef,
  DarkTheme as NavDarkTheme,
  DefaultTheme as NavLightTheme,
} from "@react-navigation/native";

import { createStackNavigator } from "@react-navigation/stack";
import { Ionicons } from "@expo/vector-icons";
import { AlertsProvider } from "./AlertsContext";
// IMPORTAÇÃO MODIFICADA
import { registerForFcmAndSendToBackend } from "./notificationService";
import NotificationHandler from "./NotificationHandler";
import { getTheme } from "./theme";

// --- IMPORTAÇÕES ADICIONADAS E MODIFICADAS (API MODULAR) ---
import messaging from "@react-native-firebase/messaging";
import * as Notifications from "expo-notifications";
import AsyncStorage from "@react-native-async-storage/async-storage";
// --- FIM DAS IMPORTAÇÕES ---

// Telas
import LoginScreen from "./LoginScreen";
import SignUpScreen from "./SignUpScreen";
import ForgotPasswordScreen from "./ForgotPasswordScreen";
import MainScreen from "./MainScreen";
import CategoryDevicesScreen from "./CategoryDevicesScreen";
import LogsScreen from "./LogsScreen";
import SettingsScreen from "./SettingsScreen";
import DeviceRegistryScreen from "./DeviceRegistryScreen";
import UserDataScreen from "./UserDataScreen";
import ElderlyDataScreen from "./ElderlyDataScreen";
import UserListScreen from "./UserListScreen";
import AboutScreen from "./AboutScreen";

const Stack = createStackNavigator();

export default function App() {
  const [expoPushToken, setExpoPushToken] = useState("");
  const [user, setUser] = useState(null); // Estado para controlar o usuário logado
  const [pendingNav, setPendingNav] = useState(null); // guarda navegação pendente ao clicar na notificação sem sessão
  const [themeName, setThemeName] = useState('dark');

  // --- ADICIONADO ---
  // Ref para navegar ao clicar na notificação
  const navigationRef = useNavigationContainerRef();
  const SERVER_HTTP_BASE = "http://192.168.2.115:86";

  // --- USE EFFECT: auto-login (persistência de sessão) ---
  useEffect(() => {
    (async () => {
      try {
        const json = await AsyncStorage.getItem("arp_user");
        if (json) {
          const savedUser = JSON.parse(json);
          setUser(savedUser);
        }
        const savedTheme = await AsyncStorage.getItem('app_theme');
        if (savedTheme) setThemeName(savedTheme);
      } catch (e) {
        console.warn("Falha ao carregar sessão persistida:", e);
      }
    })();
  }, []);

  // --- USE EFFECT: apenas registro do token push ---
  useEffect(() => {
    // Se não há usuário, não faz nada (e limpa listeners antigos se houver)
    if (!user) {
      return;
    }

    // 1. REGISTRO DO TOKEN (LÓGICA EXISTENTE)
    // Assegura que temos um ID de usuário antes de registrar
    const userId = user?.id;
    if (userId) {
      (async () => {
        const token = await registerForFcmAndSendToBackend(userId);
        if (token) {
          setExpoPushToken(token);
          console.log("FCM token registrado:", token);
        }
      })();
    }

  }, [user]); // Dependência [user] está correta

  const handleLoginSuccess = (userData) => {
    setUser(userData);
    // persiste sessão
    AsyncStorage.setItem("arp_user", JSON.stringify(userData)).catch(() => {});
    // se havia navegação pendente da notificação, resolve agora
    if (pendingNav) {
      try {
        const { routeName, params } = pendingNav;
        if (navigationRef.current && routeName) {
          navigationRef.current.navigate(routeName, params || {});
        }
      } finally {
        setPendingNav(null);
      }
    }
  };

  const handleLogout = () => {
    setUser(null);
    AsyncStorage.removeItem("arp_user").catch(() => {});
  };

  // Resolve rota de destino com base no deviceId consultando /devices para obter deviceType
  const resolveRouteForDevice = async (deviceId) => {
    let dtype;
    try {
      const res = await fetch(`${SERVER_HTTP_BASE}/devices`);
      if (res.ok) {
        const items = await res.json();
        const found = items.find((it) => it.deviceId === deviceId);
        dtype = found?.deviceType;
      }
    } catch (_) {}
    if (dtype === 'gas_fumaca') {
      return { routeName: 'CategoryDevices', params: { categoryTitle: 'Sensores de Gás e Fumaça', categoryIcon: 'flame-outline', categoryKey: 'sensores', focusDeviceId: deviceId } };
    } else if (dtype === 'pulseira') {
      return { routeName: 'CategoryDevices', params: { categoryTitle: 'Pulseiras Assistivas', categoryIcon: 'watch-outline', categoryKey: 'pulseira', focusDeviceId: deviceId } };
    } else if (dtype === 'barreira' || dtype === 'microondas' || dtype === 'detector') {
      return { routeName: 'CategoryDevices', params: { categoryTitle: 'Detectores de Queda', categoryIcon: 'body-outline', categoryKey: 'detector', focusDeviceId: deviceId } };
    }
    // Fallback
    return { routeName: 'Main', params: {} };
  };

  // --- USE EFFECT: FCM click handling (app em background) ---
  useEffect(() => {
    const unsubscribe = messaging().onNotificationOpenedApp((remoteMessage) => {
      if (!remoteMessage) return;
      (async () => {
        const deviceId = remoteMessage.data?.deviceId || remoteMessage.data?.dispositivo || remoteMessage.data?.device_id;
        const action = deviceId ? await resolveRouteForDevice(deviceId) : { routeName: 'Main', params: {} };
        if (user) navigationRef.current?.navigate(action.routeName, action.params);
        else setPendingNav(action);
      })();
    });
    return unsubscribe;
  }, [user, navigationRef]);

  // --- USE EFFECT: FCM click handling (app fechado - cold start) ---
  useEffect(() => {
    (async () => {
      const remoteMessage = await messaging().getInitialNotification();
      if (!remoteMessage) return;
      const deviceId = remoteMessage.data?.deviceId || remoteMessage.data?.dispositivo || remoteMessage.data?.device_id;
      const action = deviceId ? await resolveRouteForDevice(deviceId) : { routeName: 'Main', params: {} };
      if (user) navigationRef.current?.navigate(action.routeName, action.params);
      else setPendingNav(action);
    })();
  }, [user, navigationRef]);

  const theme = getTheme(themeName);
  const baseNavTheme = themeName === 'light' ? NavLightTheme : NavDarkTheme;
  const navTheme = {
    ...baseNavTheme,
    colors: {
      ...baseNavTheme.colors,
      background: theme.colors.background,
      card: theme.colors.card,
      border: theme.colors.border,
      text: theme.colors.text,
      primary: theme.colors.primary,
    },
  };

  const getHeaderOptions = () => ({
    headerShown: true,
    headerStyle: {
      backgroundColor: theme.colors.card,
      elevation: 0,
      shadowOpacity: 0,
      borderBottomWidth: 1,
      borderBottomColor: theme.colors.border,
    },
    headerTintColor: theme.colors.text,
    headerTitleStyle: {
      fontWeight: "bold",
      color: theme.colors.text,
    },
  });

  return (
    // REF ADICIONADA AO CONTAINER
    <NavigationContainer ref={navigationRef} theme={navTheme}>
      <AlertsProvider user={user}>
        <NotificationHandler isAuthenticated={!!user} />
        <Stack.Navigator screenOptions={{ headerShown: false }}>
          {user ? (
            // Grupo de Telas Principais (App)
            <>
              <Stack.Screen
                name="Main"
                options={({ navigation }) => ({
                  ...getHeaderOptions(),
                  title: "Painel de Controle",
                  headerRight: () => (
                    <TouchableOpacity
                      onPress={() => navigation.navigate("Settings")}
                      style={{ marginRight: 15 }}
                      hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                    >
                      <Ionicons
                        name="settings-outline"
                        size={24}
                        color={theme.colors.text}
                      />
                    </TouchableOpacity>
                  ),
                })}
              >
                {(props) => (
                  <MainScreen
                    {...props}
                    user={user}
                    themeName={themeName}
                  />
                )}
              </Stack.Screen>
              <Stack.Screen
                name="CategoryDevices"
                options={({ route }) => ({
                  ...getHeaderOptions(),
                  title: route.params?.categoryTitle || "Dispositivos",
                })}
              >
                {(props) => (
                  <CategoryDevicesScreen
                    {...props}
                    themeName={themeName}
                  />
                )}
              </Stack.Screen>

              {/* TELA DE LOGS CORRIGIDA */}
              <Stack.Screen
                name="Logs"
                options={{
                  ...getHeaderOptions(),
                  title: "Histórico de Alertas",
                }}
              >
                {/* --- CORREÇÃO APLICADA AQUI --- */}
                {(props) => (
                  <LogsScreen {...props} user={user} themeName={themeName} />
                )}
              </Stack.Screen>

              {/* TELA DE SETTINGS CORRIGIDA */}
              <Stack.Screen
                name="Settings"
                options={{
                  ...getHeaderOptions(),
                  title: "Configurações",
                }}
              >
                {(props) => (
                  <SettingsScreen
                    {...props}
                    user={user}
                    themeName={themeName}
                    onLogout={handleLogout}
                    onChangeTheme={async (name) => {
                      setThemeName(name);
                      try {
                        await AsyncStorage.setItem('app_theme', name);
                      } catch (e) {
                        console.warn('Falha ao salvar tema', e);
                      }
                    }}
                  />
                )}
              </Stack.Screen>
              <Stack.Screen
                name="DeviceRegistry"
                options={{
                  ...getHeaderOptions(),
                  title: "Registro de Dispositivos",
                }}
              >
                {(props) => (
                  <DeviceRegistryScreen
                    {...props}
                    themeName={themeName}
                  />
                )}
              </Stack.Screen>
              <Stack.Screen
                name="UserData"
                options={{
                  ...getHeaderOptions(),
                  title: "Meus Dados",
                }}
              >
                {(props) => (
                  <UserDataScreen
                    {...props}
                    user={user}
                    themeName={themeName}
                  />
                )}
              </Stack.Screen>
              <Stack.Screen
                name="ElderlyData"
                options={{
                  ...getHeaderOptions(),
                  title: "Dados do Idoso",
                }}
              >
                {(props) => (
                  <ElderlyDataScreen
                    {...props}
                    themeName={themeName}
                  />
                )}
              </Stack.Screen>
              <Stack.Screen
                name="UserList"
                options={{
                  ...getHeaderOptions(),
                  title: "Gerenciar Usuários",
                }}
              >
                {(props) => (
                  <UserListScreen
                    {...props}
                    themeName={themeName}
                  />
                )}
              </Stack.Screen>
              <Stack.Screen
                name="About"
                options={{
                  ...getHeaderOptions(),
                  title: "Sobre o Aplicativo",
                }}
              >
                {(props) => (
                  <AboutScreen
                    {...props}
                    themeName={themeName}
                  />
                )}
              </Stack.Screen>
            </>
          ) : (
            // Grupo de Telas de Autenticação
            <>
              <Stack.Screen name="Login">
                {(props) => (
                  <LoginScreen {...props} onLoginSuccess={handleLoginSuccess} />
                )}
              </Stack.Screen>
              <Stack.Screen name="SignUp" component={SignUpScreen} />
              <Stack.Screen
                name="ForgotPassword"
                component={ForgotPasswordScreen}
              />
            </>
          )}
        </Stack.Navigator>
      </AlertsProvider>
    </NavigationContainer>
  );
}