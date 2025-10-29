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

// Persistência de autenticação
import AsyncStorage from "@react-native-async-storage/async-storage";

// --- IMPORTAÇÕES ADICIONADAS E MODIFICADAS (API MODULAR) ---
import {
  getMessaging,
  onMessage,
  onNotificationOpenedApp,
  getInitialNotification,
} from "@react-native-firebase/messaging";
import * as Notifications from "expo-notifications";
// --- FIM DAS IMPORTAÇÕES ---

// Telas
import LoginScreen from "./LoginScreen";
import SignUpScreen from "./SignUpScreen";
import ForgotPasswordScreen from "./ForgotPasswordScreen";
import MainScreen from "./MainScreen";
import CategoryDevicesScreen from "./CategoryDevicesScreen";
import LogsScreen from "./LogsScreen";
import SettingsScreen from "./SettingsScreen";
import UserDataScreen from "./UserDataScreen";
import ElderlyDataScreen from "./ElderlyDataScreen";
import UserListScreen from "./UserListScreen";
import AboutScreen from "./AboutScreen";

const Stack = createStackNavigator();

export default function App() {
  const [expoPushToken, setExpoPushToken] = useState("");
  const [user, setUser] = useState(null); // Estado para controlar o usuário logado

  // --- ADICIONADO ---
  // Ref para navegar ao clicar na notificação
  const navigationRef = useNavigationContainerRef();

  // Carrega usuário persistido ao iniciar o app
  useEffect(() => {
    (async () => {
      try {
        const stored = await AsyncStorage.getItem("auth_user");
        if (stored) {
          const parsed = JSON.parse(stored);
          setUser(parsed);
        }
      } catch (e) {
        console.error("Falha ao carregar usuário persistido:", e);
      }
    })();
  }, []);

  // --- USE EFFECT MODIFICADO ---
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

    // --- SINTAXE MODULAR ADOTADA ---
    const messaging = getMessaging();

    // 2. LISTENER DE FOREGROUND (APP ABERTO)
    const unsubscribeOnMessage = onMessage(messaging, async (remoteMessage) => {
      console.log("Mensagem recebida em Foreground:", remoteMessage);

      // Usa o expo-notifications SÓ para exibir a notificação
      await Notifications.scheduleNotificationAsync({
        content: {
          title: remoteMessage.notification?.title || "Novo Alerta",
          body: remoteMessage.notification?.body || "",
          data: remoteMessage.data,
        },
        trigger: null, // Exibe imediatamente
      });
    });

    // 3. LISTENER DE TAPS (APP EM BACKGROUND)
    const unsubscribeOnNotificationOpened = onNotificationOpenedApp(
      messaging,
      (remoteMessage) => {
        console.log(
          "Notificação fez o app abrir (background):",
          remoteMessage
        );
        // Exemplo: Navega para a tela de Histórico/Logs
        if (navigationRef.isReady()) {
          navigationRef.navigate("History");
        }
      }
    );

    // 4. CHECAGEM DE TAP (APP FECHADO)
    getInitialNotification(messaging).then((remoteMessage) => {
      if (remoteMessage) {
        console.log(
          "Notificação fez o app abrir (fechado):",
          remoteMessage
        );
        // Você pode querer guardar isso em um state e navegar
        // quando o navigationRef estiver pronto
        if (navigationRef.isReady()) {
          navigationRef.navigate("History");
        }
      }
    });

    // Função de limpeza (roda quando o 'user' muda, ex: logout)
    return () => {
      unsubscribeOnMessage();
      unsubscribeOnNotificationOpened();
    };
  }, [user]); // Dependência [user] está correta

  const handleLoginSuccess = (userData) => {
    setUser(userData);
    // Persiste o usuário autenticado
    AsyncStorage.setItem("auth_user", JSON.stringify(userData)).catch((e) =>
      console.error("Falha ao salvar usuário:", e)
    );
  };

  const handleLogout = () => {
    setUser(null);
    // Remove usuário persistido
    AsyncStorage.removeItem("auth_user").catch((e) =>
      console.error("Falha ao apagar usuário:", e)
    );
  };

  return (
    // REF ADICIONADA AO CONTAINER
    <NavigationContainer ref={navigationRef}>
      <AlertsProvider user={user}>
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

