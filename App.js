import { useState, useEffect, useRef } from "react";
import { TouchableOpacity } from "react-native";
import { NavigationContainer } from "@react-navigation/native";

import { createStackNavigator } from "@react-navigation/stack";
import { Ionicons } from "@expo/vector-icons";
import { AlertsProvider } from "./AlertsContext";
import { registerForFcmAndSendToBackend, setupNotificationHandlers } from "./notificationService";

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

  useEffect(() => {
    let unsubscribe = () => {};
    (async () => {
      const token = await registerForFcmAndSendToBackend(user?.id);
      if (token) {
        setExpoPushToken(token);
        console.log("FCM token:", token);
      }
    })();
    unsubscribe = setupNotificationHandlers((notification) => {
      console.log("Notificação recebida:", notification?.request?.content);
    });
    return () => {
      unsubscribe && unsubscribe();
    };
  }, [user]);

  const handleLoginSuccess = (userData) => {
    setUser(userData);
  };

  const handleLogout = () => {
    setUser(null);
  };

  return (
    <NavigationContainer>
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
                  headerStyle: { backgroundColor: "#1f2937"},
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
                  title: route.params?.categoryTitle || "Dispositivos"
                })}
              />
              <Stack.Screen
                name="History"
                component={LogsScreen}
                options={{ headerShown: true, title: "Histórico de Registros" }}
              />
              <Stack.Screen name="Settings" options={{ title: "Configurações", headerShown: true, headerStyle: { backgroundColor: "#1f2937" }, headerTintColor: "#f9fafb", headerTitleStyle: { fontWeight: "bold" } }}>
                {(props) => (
                  <SettingsScreen {...props} onLogout={handleLogout} />
                )}
              </Stack.Screen>
              <Stack.Screen
                name="UserData"
                options={{ headerShown: true, title: "Meus Dados", headerStyle: { backgroundColor: "#1f2937" }, headerTintColor: "#f9fafb", headerTitleStyle: { fontWeight: "bold" } }}
              >
                {(props) => <UserDataScreen {...props} user={user} />}
              </Stack.Screen>
              <Stack.Screen
                name="ElderlyData"
                component={ElderlyDataScreen}
                options={{ headerShown: true, title: "Dados do Idoso", headerStyle: { backgroundColor: "#1f2937" }, headerTintColor: "#f9fafb", headerTitleStyle: { fontWeight: "bold" } }}
              />
              <Stack.Screen
                name="UserList"
                component={UserListScreen}
                options={{ headerShown: true, title: "Gerenciar Usuários", headerStyle: { backgroundColor: "#1f2937" }, headerTintColor: "#f9fafb", headerTitleStyle: { fontWeight: "bold" } }}
              />
              <Stack.Screen
                name="About"
                component={AboutScreen}
                options={{ headerShown: true, title: "Sobre o Aplicativo", headerStyle: { backgroundColor: "#1f2937" }, headerTintColor: "#f9fafb", headerTitleStyle: { fontWeight: "bold" } }}
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
