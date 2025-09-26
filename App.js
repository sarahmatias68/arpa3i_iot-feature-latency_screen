import { useState, useEffect, useRef } from "react";
import { TouchableOpacity, Platform } from "react-native";
import { NavigationContainer } from "@react-navigation/native";
import * as Notifications from "expo-notifications";
import { createStackNavigator } from "@react-navigation/stack";
import { Ionicons } from "@expo/vector-icons";
import { AlertsProvider } from "./AlertsContext";

// Telas
import LoginScreen from "./LoginScreen";
import SignUpScreen from "./SignUpScreen";
import ForgotPasswordScreen from "./ForgotPasswordScreen";
import MainScreen from "./MainScreen";
import LogsScreen from "./LogsScreen";
import SettingsScreen from "./SettingsScreen";
import UserDataScreen from "./UserDataScreen";
import ElderlyDataScreen from "./ElderlyDataScreen";
import UserListScreen from "./UserListScreen";
import PermissionsScreen from "./PermissionsScreen";
import AboutScreen from "./AboutScreen";

const Stack = createStackNavigator();

export default function App() {
  const [expoPushToken, setExpoPushToken] = useState("");
  const [user, setUser] = useState(null); // Estado para controlar o usuário logado

  useEffect(() => {
    registerForPushNotificationsAsync().then((token) => {
      if (token) {
        setExpoPushToken(token);
        console.log("Expo Push Token:", token);
        // Aqui você enviaria o token para o seu servidor
      }
    });
  }, []);

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
                name="History"
                component={LogsScreen}
                options={{ headerShown: true, title: "Histórico de Registros" }}
              />
              <Stack.Screen name="Settings" options={{ headerShown: true }}>
                {(props) => (
                  <SettingsScreen {...props} onLogout={handleLogout} />
                )}
              </Stack.Screen>
              <Stack.Screen
                name="UserData"
                options={{ headerShown: true, title: "Meus Dados" }}
              >
                {(props) => <UserDataScreen {...props} user={user} />}
              </Stack.Screen>
              <Stack.Screen
                name="ElderlyData"
                component={ElderlyDataScreen}
                options={{ headerShown: true, title: "Dados do Idoso" }}
              />
              <Stack.Screen
                name="UserList"
                component={UserListScreen}
                options={{ headerShown: true, title: "Gerenciar Usuários" }}
              />
              <Stack.Screen
                name="Permissions"
                component={PermissionsScreen}
                options={{ headerShown: true, title: "Permissões" }}
              />
              <Stack.Screen
                name="About"
                component={AboutScreen}
                options={{ headerShown: true, title: "Sobre o Aplicativo" }}
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

async function registerForPushNotificationsAsync() {
  let token;
  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync("default", {
      name: "default",
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: "#FF231F7C",
    });
  }

  const { status: existingStatus } = await Notifications.getPermissionsAsync();
  let finalStatus = existingStatus;
  if (existingStatus !== "granted") {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }
  if (finalStatus !== "granted") {
    alert("Failed to get push token for push notification!");
    return;
  }
  token = (await Notifications.getExpoPushTokenAsync()).data;

  return token;
}
