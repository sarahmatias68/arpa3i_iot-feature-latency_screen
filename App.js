import { useState, useEffect } from "react";
import { TouchableOpacity } from "react-native";
// IMPORTAÇÃO MODIFICADA
import {
  NavigationContainer,
  useNavigationContainerRef,
} from "@react-navigation/native";

import { createStackNavigator } from "@react-navigation/stack";
import { Ionicons } from "@expo/vector-icons";
import { AlertsProvider } from "./AlertsContext";
// IMPORTAÇÃO MODIFICADA
import { registerForFcmAndSendToBackend } from "./notificationService";
import NotificationHandler from "./NotificationHandler";

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

  // --- ADICIONADO ---
  // Ref para navegar ao clicar na notificação
  const navigationRef = useNavigationContainerRef();

  // --- USE EFFECT: auto-login (persistência de sessão) ---
  useEffect(() => {
    (async () => {
      try {
        const json = await AsyncStorage.getItem("arp_user");
        if (json) {
          const savedUser = JSON.parse(json);
          setUser(savedUser);
        }
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

  // --- USE EFFECT: FCM click handling (app em background) ---
  useEffect(() => {
    const unsubscribe = messaging().onNotificationOpenedApp((remoteMessage) => {
      if (!remoteMessage) return;
      const deviceId = remoteMessage.data?.deviceId;
      const alertType = remoteMessage.data?.alertType;
      const params = deviceId ? { focusDeviceId: deviceId, alertType } : {};
      const action = { routeName: "Main", params };
      if (user) {
        navigationRef.current?.navigate(action.routeName, action.params);
      } else {
        setPendingNav(action);
      }
    });
    return unsubscribe;
  }, [user, navigationRef]);

  // --- USE EFFECT: FCM click handling (app fechado - cold start) ---
  useEffect(() => {
    (async () => {
      const remoteMessage = await messaging().getInitialNotification();
      if (!remoteMessage) return;
      const deviceId = remoteMessage.data?.deviceId;
      const alertType = remoteMessage.data?.alertType;
      const params = deviceId ? { focusDeviceId: deviceId, alertType } : {};
      const action = { routeName: "Main", params };
      if (user) {
        navigationRef.current?.navigate(action.routeName, action.params);
      } else {
        setPendingNav(action);
      }
    })();
  }, [user, navigationRef]);

  return (
    // REF ADICIONADA AO CONTAINER
    <NavigationContainer ref={navigationRef}>
      <AlertsProvider user={user}>
        <NotificationHandler isAuthenticated={!!user} />
        <Stack.Navigator screenOptions={{ headerShown: false }}>
          {user ? (
            // Grupo de Telas Principais (App)
            <>
              <Stack.Screen
                name="Main"
                options={({ navigation }) => ({
                  headerShown: true,
                  title: "Painel de Controle",
                  headerStyle: { backgroundColor: "#1f2937" },
                  headerTintColor: "#f9fafb",
                  headerTitleStyle: { fontWeight: "bold" },
                  headerRight: () => (
                    <TouchableOpacity
                      onPress={() => navigation.navigate("Settings")}
                      style={{ marginRight: 15 }}
                    >
                      <Ionicons
                        name="settings-outline"
                        size={24}
                        color="#f9fafb"
                      />
                    </TouchableOpacity>
                  ),
                })}
              >
                {(props) => <MainScreen {...props} user={user} />}
              </Stack.Screen>
              <Stack.Screen
                name="CategoryDevices"
                component={CategoryDevicesScreen}
                options={({ route }) => ({
                  headerShown: true,
                  title: route.params?.categoryTitle || "Dispositivos",
                })}
              />
              <Stack.Screen
                name="History" // Este é o nome que usamos no listener
                component={LogsScreen}
                options={{ headerShown: true, title: "Histórico de Registros" }}
              />
              <Stack.Screen
                name="Settings"
                options={{
                  title: "Configurações",
                  headerShown: true,
                  headerStyle: { backgroundColor: "#1f2937" },
                  headerTintColor: "#f9fafb",
                  headerTitleStyle: { fontWeight: "bold" },
                }}
              >
                {(props) => (
                  <SettingsScreen {...props} onLogout={handleLogout} />
                )}
              </Stack.Screen>
              <Stack.Screen
                name="DeviceRegistry"
                component={DeviceRegistryScreen}
                options={{
                  headerShown: true,
                  title: "Dispositivos",
                  headerStyle: { backgroundColor: "#1f2937" },
                  headerTintColor: "#f9fafb",
                  headerTitleStyle: { fontWeight: "bold" },
                }}
              />
              <Stack.Screen
                name="UserData"
                options={{
                  headerShown: true,
                  title: "Meus Dados",
                  headerStyle: { backgroundColor: "#1f2937" },
                  headerTintColor: "#f9fafb",
                  headerTitleStyle: { fontWeight: "bold" },
                }}
              >
                {(props) => <UserDataScreen {...props} user={user} />}
              </Stack.Screen>
              <Stack.Screen
                name="ElderlyData"
                component={ElderlyDataScreen}
                options={{
                  headerShown: true,
                  title: "Dados do Idoso",
                  headerStyle: { backgroundColor: "#1f2937" },
                  headerTintColor: "#f9fafb",
                  headerTitleStyle: { fontWeight: "bold" },
                }}
              />
              <Stack.Screen
                name="UserList"
                component={UserListScreen}
                options={{
                  headerShown: true,
                  title: "Gerenciar Usuários",
                  headerStyle: { backgroundColor: "#1f2937" },
                  headerTintColor: "#f9fafb",
                  headerTitleStyle: { fontWeight: "bold" },
                }}
              />
              <Stack.Screen
                name="About"
                component={AboutScreen}
                options={{
                  headerShown: true,
                  title: "Sobre o Aplicativo",
                  headerStyle: { backgroundColor: "#1f2937" },
                  headerTintColor: "#f9fafb",
                  headerTitleStyle: { fontWeight: "bold" },
                }}
              />
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

