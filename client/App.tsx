import React, { useState, useEffect, useRef } from "react";
import {
  StyleSheet,
  Text,
  View,
  SafeAreaView,
  FlatList,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Alert,
  Image,
} from "react-native";
import { StatusBar } from "expo-status-bar";
import { Ionicons } from "@expo/vector-icons";

import { api, API_BASE, getWsBaseUrl, getStoredUser } from "./src/api";
import { Role, ClientMessage, RuntimeState, AffectiveState, ScheduleData, AuthUser } from "./src/types";
import { ChatMessageItem } from "./src/components/ChatMessageItem";
import { RoleSelector } from "./src/components/RoleSelector";
import { StateDrawer } from "./src/components/StateDrawer";
import { BindAccountModal } from "./src/components/BindAccountModal";

export default function App() {
  const [currentUser, setCurrentUser] = useState<AuthUser | null>(getStoredUser());
  const [bindModalVisible, setBindModalVisible] = useState(false);

  const [roles, setRoles] = useState<Role[]>([]);
  const [activeRole, setActiveRole] = useState<Role | null>(null);
  const [messages, setMessages] = useState<ClientMessage[]>([]);
  const [runtimeState, setRuntimeState] = useState<RuntimeState | null>(null);
  const [affectiveState, setAffectiveState] = useState<AffectiveState | null>(null);
  const [schedule, setSchedule] = useState<ScheduleData | null>(null);
  const [isSleeping, setIsSleeping] = useState(false);

  const [inputText, setInputText] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [isTyping, setIsTyping] = useState(false);
  const [wsConnected, setWsConnected] = useState(false);
  const [roleModalVisible, setRoleModalVisible] = useState(false);
  const [stateDrawerVisible, setStateDrawerVisible] = useState(false);

  const flatListRef = useRef<FlatList>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const typingTimerRef = useRef<any>(null);

  // Initialize Auth & Load initial roles
  useEffect(() => {
    let checkCode = "";
    if (Platform.OS === "web" && typeof window !== "undefined" && window.location) {
      try {
        const params = new URLSearchParams(window.location.search);
        checkCode = params.get("code") || "";
      } catch {
        // ignore
      }
    }

    if (checkCode) {
      api.verifyBindCode(checkCode).then((res) => {
        if (res.ok && res.user) {
          setCurrentUser(res.user);
          initApp(res.user);
          return;
        }
        initApp();
      });
    } else {
      initApp();
    }
  }, []);

  // WebSocket lifecycle connection for real-time sync
  useEffect(() => {
    if (!currentUser) return;

    let isMounted = true;
    let ws: WebSocket | null = null;
    let pingInterval: any = null;
    let reconnectTimer: any = null;

    const connectWs = () => {
      try {
        const wsUrl = getWsBaseUrl(currentUser);
        ws = new WebSocket(wsUrl);
        wsRef.current = ws;

        ws.onopen = () => {
          if (!isMounted) return;
          setWsConnected(true);
          pingInterval = setInterval(() => {
            if (ws && ws.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify({ type: "ping" }));
            }
          }, 25000);
        };

        ws.onmessage = (event) => {
          if (!isMounted) return;
          try {
            const data = JSON.parse(event.data);
            if (data.type === "chat.typing") {
              setIsTyping(true);
              if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
              typingTimerRef.current = setTimeout(() => {
                if (isMounted) setIsTyping(false);
              }, 4500);
            } else if (data.type === "chat.message") {
              setIsTyping(false);
              const payload = data.payload;
              if (payload?.text) {
                setMessages((prev) => {
                  const exists = prev.some(
                    (m) => m.text === payload.text && m.role === (payload.role || "assistant")
                  );
                  if (exists) return prev;
                  return [
                    ...prev,
                    {
                      id: `ws-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
                      role: payload.role || "assistant",
                      text: payload.text,
                      createdAt: new Date().toISOString(),
                    },
                  ];
                });
              }
            } else if (data.type === "chat.photo") {
              setIsTyping(false);
              const payload = data.payload;
              const photoUrl = typeof payload.photo === "string" ? payload.photo : payload.photo?.url;
              setMessages((prev) => [
                ...prev,
                {
                  id: `photo-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
                  role: "assistant",
                  text: payload.extra?.caption || "",
                  media: photoUrl ? [{ type: "image", url: photoUrl }] : undefined,
                  createdAt: new Date().toISOString(),
                },
              ]);
            } else if (data.type === "role.state_updated") {
              if (activeRole) {
                api.getState(activeRole.name).then((stateData) => {
                  if (!isMounted) return;
                  setIsSleeping(stateData.isSleeping);
                  setRuntimeState(stateData.runtimeState);
                  setAffectiveState(stateData.affectiveState);
                });
              }
            } else if (data.type === "role.proactive") {
              if (data.payload?.text) {
                setMessages((prev) => [
                  ...prev,
                  {
                    id: `proactive-${Date.now()}`,
                    role: "assistant",
                    text: data.payload.text,
                    createdAt: new Date().toISOString(),
                  },
                ]);
              }
            }
          } catch {
            // ignore malformed ws messages
          }
        };

        ws.onclose = () => {
          if (!isMounted) return;
          setWsConnected(false);
          clearInterval(pingInterval);
          reconnectTimer = setTimeout(connectWs, 3000);
        };

        ws.onerror = () => {
          ws?.close();
        };
      } catch {
        reconnectTimer = setTimeout(connectWs, 3000);
      }
    };

    connectWs();

    return () => {
      isMounted = false;
      clearInterval(pingInterval);
      clearTimeout(reconnectTimer);
      if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
      ws?.close();
    };
  }, [activeRole?.name, currentUser?.userId]);

  const initApp = async (userOverride?: AuthUser | null) => {
    const activeUser = userOverride !== undefined ? userOverride : currentUser;
    if (!activeUser) {
      setLoading(false);
      setBindModalVisible(true);
      return;
    }

    try {
      setLoading(true);
      const roleList = await api.getRoles();
      setRoles(roleList);

      const session = await api.getSession();
      let currentRole = roleList[0];
      if (session?.roleName) {
        const found = roleList.find((r) => r.name === session.roleName);
        if (found) currentRole = found;
      }

      if (currentRole) {
        setActiveRole(currentRole);
        await loadRoleData(currentRole.name);
      }
    } catch (error) {
      console.error("Init app error:", error);
    } finally {
      setLoading(false);
    }
  };

  const loadRoleData = async (roleName: string) => {
    try {
      const [msgList, stateData, scheduleData] = await Promise.all([
        api.getMessages(),
        api.getState(roleName),
        api.getSchedule(roleName),
      ]);
      setMessages(msgList);
      setIsSleeping(stateData.isSleeping);
      setRuntimeState(stateData.runtimeState);
      setAffectiveState(stateData.affectiveState);
      setSchedule(scheduleData);
    } catch (err) {
      console.warn("Load role data failed:", err);
    }
  };

  const handleSelectRole = async (role: Role) => {
    try {
      setRoleModalVisible(false);
      setActiveRole(role);
      setLoading(true);
      await api.switchRole(role.name);
      await loadRoleData(role.name);
    } catch (err: any) {
      Alert.alert("切换角色失败", err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleSend = async (customText?: string) => {
    const textToSend = customText || inputText.trim();
    if (!textToSend || sending) return;

    setInputText("");
    const tempId = `temp-${Date.now()}`;
    const userMsg: ClientMessage = {
      id: tempId,
      role: "user",
      text: textToSend,
      createdAt: new Date().toISOString(),
    };

    setMessages((prev) => [...prev, userMsg]);
    setSending(true);
    setIsTyping(true);

    try {
      const res = await api.sendMessage(textToSend, activeRole?.name);
      if (res.ok && res.message) {
        setMessages((prev) => {
          const withoutTemp = prev.filter((m) => m.id !== tempId);
          return [...withoutTemp, userMsg, res.message!];
        });
      } else if (res.ok && res.reply) {
        setMessages((prev) => {
          const withoutTemp = prev.filter((m) => m.id !== tempId);
          return [
            ...withoutTemp,
            userMsg,
            {
              id: `reply-${Date.now()}`,
              role: "assistant",
              text: res.reply!,
              createdAt: new Date().toISOString(),
            },
          ];
        });
      } else if (!res.ok) {
        Alert.alert("发送失败", res.error || "未能获取角色回复");
      }
      // Refresh character live state after dialogue
      if (activeRole) {
        const stateData = await api.getState(activeRole.name);
        setIsSleeping(stateData.isSleeping);
        setRuntimeState(stateData.runtimeState);
        setAffectiveState(stateData.affectiveState);
      }
    } catch (error: any) {
      Alert.alert("网络异常", error.message || "连接服务器失败");
    } finally {
      setSending(false);
      setIsTyping(false);
    }
  };

  const handleWakeCaffeine = async () => {
    if (!activeRole) return;
    try {
      const res = await api.caffeineWake(activeRole.name);
      Alert.alert("咖啡唤醒", res.message);
      const stateData = await api.getState(activeRole.name);
      setIsSleeping(stateData.isSleeping);
      setRuntimeState(stateData.runtimeState);
    } catch (err: any) {
      Alert.alert("叫醒失败", err.message);
    }
  };

  const handleClearHistory = () => {
    Alert.alert("清空对话", "确定要永久清空当前角色的历史记录吗？", [
      { text: "取消", style: "cancel" },
      {
        text: "确定清空",
        style: "destructive",
        onPress: async () => {
          await api.clearChat();
          setMessages([]);
        },
      },
    ]);
  };

  const handleAuthSuccess = async (user: AuthUser) => {
    setCurrentUser(user);
    setBindModalVisible(false);
    await initApp(user);
  };

  const handleAuthLogout = async () => {
    api.logout();
    setCurrentUser(null);
    setMessages([]);
    setActiveRole(null);
    setRoles([]);
    setBindModalVisible(true);
  };

  const avatarUrl = activeRole?.avatarUrl ? `${API_BASE}${activeRole.avatarUrl}` : null;

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar style="light" />

      <View style={styles.appContainer}>
        {/* Top Navigation Bar */}
        <View style={styles.topBar}>
          <TouchableOpacity
            style={styles.roleHeader}
            onPress={() => setRoleModalVisible(true)}
            activeOpacity={0.7}
          >
            {avatarUrl ? (
              <Image source={{ uri: avatarUrl }} style={styles.roleAvatar} />
            ) : (
              <View style={[styles.roleAvatar, styles.roleAvatarFallback]}>
                <Text style={styles.roleAvatarText}>{activeRole?.name.slice(0, 1) || "?"}</Text>
              </View>
            )}

            <View style={{ flex: 1 }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                <Text style={styles.roleNameText}>{activeRole?.name || "角色载入中..."}</Text>
                <Ionicons name="chevron-down" size={14} color="#94a3b8" />
                <View
                  style={[
                    styles.statusBadgeDot,
                    { backgroundColor: wsConnected ? "#10b981" : "#f59e0b" },
                  ]}
                />
              </View>

              <Text style={styles.statusSubText} numberOfLines={1}>
                {isSleeping
                  ? "🌙 正在熟睡 / 小憩"
                  : runtimeState?.activity
                  ? `📍 [${runtimeState.location || "当前"}] ${runtimeState.activity}`
                  : "在线"}
              </Text>
            </View>
          </TouchableOpacity>

          {/* Action Buttons */}
          <View style={styles.topActions}>
            {/* User Account / Bind Pill */}
            <TouchableOpacity
              style={styles.userBadgeBtn}
              onPress={() => setBindModalVisible(true)}
              activeOpacity={0.7}
            >
              <Ionicons
                name={currentUser?.isGuest ? "person-outline" : "paper-plane"}
                size={13}
                color={currentUser ? "#818cf8" : "#f59e0b"}
              />
              <Text style={styles.userBadgeText} numberOfLines={1}>
                {currentUser ? currentUser.displayName : "绑定TG"}
              </Text>
            </TouchableOpacity>

            {isSleeping && (
              <TouchableOpacity
                style={[styles.topIconBtn, { borderColor: "#f59e0b" }]}
                onPress={handleWakeCaffeine}
              >
                <Ionicons name="cafe" size={18} color="#f59e0b" />
              </TouchableOpacity>
            )}

            <TouchableOpacity
              style={styles.topIconBtn}
              onPress={() => setStateDrawerVisible(true)}
            >
              <Ionicons name="stats-chart" size={18} color="#818cf8" />
            </TouchableOpacity>

            <TouchableOpacity style={styles.topIconBtn} onPress={handleClearHistory}>
              <Ionicons name="trash-outline" size={18} color="#94a3b8" />
            </TouchableOpacity>
          </View>
        </View>

        {/* Main Message Stream */}
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === "ios" ? "padding" : undefined}
        >
          {loading ? (
            <View style={styles.centerContainer}>
              <ActivityIndicator size="large" color="#6366f1" />
              <Text style={styles.loadingText}>正在载入对话记录...</Text>
            </View>
          ) : (
            <FlatList
              ref={flatListRef}
              data={messages}
              keyExtractor={(item) => item.id}
              renderItem={({ item }) => (
                <ChatMessageItem
                  message={item}
                  roleName={activeRole?.name || "角色"}
                  avatarUrl={avatarUrl}
                />
              )}
              contentContainerStyle={styles.messageList}
              onContentSizeChange={() => flatListRef.current?.scrollToEnd({ animated: true })}
              ListFooterComponent={
                isTyping || sending ? (
                  <View style={styles.typingContainer}>
                    <View style={styles.typingBubble}>
                      <View style={styles.typingDot} />
                      <View style={styles.typingDot} />
                      <View style={styles.typingDot} />
                      <Text style={styles.typingText}>
                        {activeRole?.name || "角色"} 正在构思回复...
                      </Text>
                    </View>
                  </View>
                ) : undefined
              }
              ListEmptyComponent={
                <View style={styles.emptyMessages}>
                  <Text style={{ fontSize: 40, marginBottom: 12 }}>💬</Text>
                  <Text style={styles.emptyTitle}>与「{activeRole?.name}」的新对话</Text>
                  <Text style={styles.emptySubTitle}>
                    {activeRole?.description || "发条消息开始交流吧！"}
                  </Text>
                </View>
              }
            />
          )}

          {/* Quick Suggestion Pills */}
          <View style={styles.quickPillsRow}>
            <TouchableOpacity
              style={styles.pill}
              onPress={() => handleSend("你在做什么呢？")}
            >
              <Text style={styles.pillText}>你在做什么？</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.pill}
              onPress={() => handleSend("今天有什么日程安排？")}
            >
              <Text style={styles.pillText}>今天有什么安排？</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.pill}
              onPress={() => handleSend("累不累？记得休息一下")}
            >
              <Text style={styles.pillText}>累不累？</Text>
            </TouchableOpacity>
          </View>

          {/* Input Bar */}
          <View style={styles.inputContainer}>
            <TextInput
              style={styles.input}
              placeholder={`给「${activeRole?.name || "角色"}」发消息...`}
              placeholderTextColor="#64748b"
              value={inputText}
              onChangeText={setInputText}
              multiline
              maxLength={1000}
              editable={!sending}
            />

            <TouchableOpacity
              style={[styles.sendButton, (!inputText.trim() || sending) && styles.sendButtonDisabled]}
              onPress={() => handleSend()}
              disabled={!inputText.trim() || sending}
              activeOpacity={0.8}
            >
              {sending ? (
                <ActivityIndicator size="small" color="#ffffff" />
              ) : (
                <Ionicons name="arrow-up" size={20} color="#ffffff" />
              )}
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>

        {/* Role Selection Modal */}
        <RoleSelector
          visible={roleModalVisible}
          roles={roles}
          activeRoleName={activeRole?.name || ""}
          onSelectRole={handleSelectRole}
          onClose={() => setRoleModalVisible(false)}
        />

        {/* Character State & Schedule Drawer Modal */}
        <StateDrawer
          visible={stateDrawerVisible}
          roleName={activeRole?.name || ""}
          isSleeping={isSleeping}
          runtimeState={runtimeState}
          affectiveState={affectiveState}
          schedule={schedule}
          loading={false}
          onWakeCaffeine={handleWakeCaffeine}
          onClose={() => setStateDrawerVisible(false)}
        />

        {/* Telegram Account Bind Modal */}
        <BindAccountModal
          visible={bindModalVisible}
          currentUser={currentUser}
          onSuccess={handleAuthSuccess}
          onLogout={handleAuthLogout}
          onClose={currentUser ? () => setBindModalVisible(false) : undefined}
        />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: "#090d16",
  },
  appContainer: {
    flex: 1,
    width: "100%",
    maxWidth: 900,
    alignSelf: "center",
    backgroundColor: "#0f172a",
    borderLeftWidth: Platform.OS === "web" ? 1 : 0,
    borderRightWidth: Platform.OS === "web" ? 1 : 0,
    borderColor: "#1e293b",
  },
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: "#1e293b",
    borderBottomWidth: 1,
    borderBottomColor: "#334155",
  },
  roleHeader: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginRight: 8,
  },
  roleAvatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "#334155",
  },
  roleAvatarFallback: {
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#4f46e5",
  },
  roleAvatarText: {
    fontSize: 18,
    fontWeight: "700",
    color: "#ffffff",
  },
  roleNameText: {
    fontSize: 16,
    fontWeight: "700",
    color: "#f8fafc",
  },
  statusBadgeDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  statusSubText: {
    fontSize: 12,
    color: "#94a3b8",
    marginTop: 2,
  },
  topActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  userBadgeBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    backgroundColor: "#0f172a",
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#334155",
    maxWidth: 110,
  },
  userBadgeText: {
    fontSize: 12,
    fontWeight: "600",
    color: "#c7d2fe",
  },
  topIconBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "#0f172a",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "#334155",
  },
  centerContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
  },
  loadingText: {
    fontSize: 14,
    color: "#94a3b8",
  },
  messageList: {
    paddingVertical: 16,
  },
  emptyMessages: {
    padding: 40,
    alignItems: "center",
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: "#f8fafc",
    marginBottom: 6,
  },
  emptySubTitle: {
    fontSize: 13,
    color: "#94a3b8",
    textAlign: "center",
    lineHeight: 18,
  },
  quickPillsRow: {
    flexDirection: "row",
    paddingHorizontal: 16,
    paddingBottom: 8,
    gap: 8,
  },
  pill: {
    backgroundColor: "#1e293b",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#334155",
  },
  pillText: {
    fontSize: 12,
    color: "#cbd5e1",
    fontWeight: "500",
  },
  typingContainer: {
    paddingHorizontal: 16,
    paddingVertical: 6,
  },
  typingBubble: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#1e293b",
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 16,
    alignSelf: "flex-start",
    gap: 6,
    borderWidth: 1,
    borderColor: "#334155",
  },
  typingDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: "#818cf8",
  },
  typingText: {
    fontSize: 12,
    color: "#94a3b8",
    marginLeft: 4,
  },
  inputContainer: {
    flexDirection: "row",
    alignItems: "flex-end",
    paddingHorizontal: 14,
    paddingVertical: 10,
    backgroundColor: "#1e293b",
    borderTopWidth: 1,
    borderTopColor: "#334155",
    gap: 10,
  },
  input: {
    flex: 1,
    minHeight: 40,
    maxHeight: 120,
    backgroundColor: "#0f172a",
    color: "#f8fafc",
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 10,
    fontSize: 15,
    borderWidth: 1,
    borderColor: "#334155",
  },
  sendButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "#4f46e5",
    alignItems: "center",
    justifyContent: "center",
  },
  sendButtonDisabled: {
    backgroundColor: "#334155",
    opacity: 0.6,
  },
});
