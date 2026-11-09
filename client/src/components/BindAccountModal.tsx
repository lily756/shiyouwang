import React, { useState } from "react";
import {
  Modal,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Alert,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { AuthUser } from "../types";
import { api } from "../api";

interface Props {
  visible: boolean;
  currentUser: AuthUser | null;
  onSuccess: (user: AuthUser) => void;
  onLogout: () => void;
  onClose?: () => void;
}

export const BindAccountModal: React.FC<Props> = ({
  visible,
  currentUser,
  onSuccess,
  onLogout,
  onClose,
}) => {
  const [bindCode, setBindCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [guestLoading, setGuestLoading] = useState(false);

  const handleVerify = async () => {
    const code = bindCode.trim();
    if (!code) {
      Alert.alert("提示", "请输入在 Telegram 获取的 6 位绑定码");
      return;
    }

    try {
      setLoading(true);
      const res = await api.verifyBindCode(code);
      if (res.ok && res.user) {
        Alert.alert("绑定成功", `已连接至账号「${res.user.displayName}」`);
        setBindCode("");
        onSuccess(res.user);
      } else {
        Alert.alert("绑定失败", res.error || "绑定码无效或已过期");
      }
    } catch (err: any) {
      Alert.alert("网络异常", err.message || "请求服务器失败");
    } finally {
      setLoading(false);
    }
  };

  const handleGuest = async () => {
    try {
      setGuestLoading(true);
      const res = await api.createGuestUser();
      if (res.ok && res.user) {
        onSuccess(res.user);
      } else {
        Alert.alert("进入失败", res.error || "创建访客失败");
      }
    } catch (err: any) {
      Alert.alert("网络异常", err.message || "连接服务器失败");
    } finally {
      setGuestLoading(false);
    }
  };

  return (
    <Modal visible={visible} animationType="fade" transparent onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.modalBox}>
          {/* Header */}
          <View style={styles.header}>
            <View style={styles.iconCircle}>
              <Ionicons name="paper-plane" size={24} color="#6366f1" />
            </View>
            <Text style={styles.title}>
              {currentUser ? "账号信息与切换" : "绑定 Telegram 账号"}
            </Text>
            <Text style={styles.subtitle}>
              {currentUser
                ? `当前登录：${currentUser.displayName} (${currentUser.isGuest ? "独立访客" : "Telegram 同步"})`
                : "在 Telegram 中向机器人发送 /bind 获取 6 位临时验证码，即可在 Web/App 端无缝同步角色与聊天。"}
            </Text>
          </View>

          {/* Form */}
          {!currentUser ? (
            <View style={styles.formContainer}>
              <Text style={styles.inputLabel}>输入 6 位绑定码：</Text>
              <TextInput
                style={styles.codeInput}
                placeholder="例如：682941"
                placeholderTextColor="#64748b"
                value={bindCode}
                onChangeText={setBindCode}
                keyboardType="numeric"
                maxLength={8}
                autoCapitalize="characters"
                autoFocus
              />

              <TouchableOpacity
                style={[styles.primaryBtn, (!bindCode.trim() || loading) && styles.btnDisabled]}
                onPress={handleVerify}
                disabled={!bindCode.trim() || loading}
                activeOpacity={0.8}
              >
                {loading ? (
                  <ActivityIndicator size="small" color="#ffffff" />
                ) : (
                  <>
                    <Ionicons name="link" size={18} color="#ffffff" />
                    <Text style={styles.primaryBtnText}>一键验证并登录</Text>
                  </>
                )}
              </TouchableOpacity>

              <View style={styles.dividerRow}>
                <View style={styles.dividerLine} />
                <Text style={styles.dividerText}>或者</Text>
                <View style={styles.dividerLine} />
              </View>

              <TouchableOpacity
                style={styles.secondaryBtn}
                onPress={handleGuest}
                disabled={guestLoading}
                activeOpacity={0.7}
              >
                {guestLoading ? (
                  <ActivityIndicator size="small" color="#94a3b8" />
                ) : (
                  <>
                    <Ionicons name="person-outline" size={16} color="#94a3b8" />
                    <Text style={styles.secondaryBtnText}>暂不绑定，以全新访客体验</Text>
                  </>
                )}
              </TouchableOpacity>
            </View>
          ) : (
            <View style={styles.formContainer}>
              <View style={styles.userCard}>
                <Text style={styles.userCardTitle}>已绑定的账号</Text>
                <Text style={styles.userCardName}>{currentUser.displayName}</Text>
                <Text style={styles.userCardId}>用户 ID: {currentUser.userId}</Text>
              </View>

              <TouchableOpacity
                style={[styles.primaryBtn, { backgroundColor: "#ef4444" }]}
                onPress={onLogout}
                activeOpacity={0.8}
              >
                <Ionicons name="log-out-outline" size={18} color="#ffffff" />
                <Text style={styles.primaryBtnText}>切换账号 / 解除绑定</Text>
              </TouchableOpacity>

              {onClose && (
                <TouchableOpacity
                  style={[styles.secondaryBtn, { marginTop: 10 }]}
                  onPress={onClose}
                  activeOpacity={0.7}
                >
                  <Text style={styles.secondaryBtnText}>返回继续聊天</Text>
                </TouchableOpacity>
              )}
            </View>
          )}

          {/* Tips footer */}
          <View style={styles.footerTip}>
            <Ionicons name="information-circle-outline" size={14} color="#64748b" />
            <Text style={styles.footerTipText}>
              提示：在 Telegram Bot 中直接输入 /bind 即可立即获得绑定码。
            </Text>
          </View>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.75)",
    justifyContent: "center",
    alignItems: "center",
    padding: 20,
  },
  modalBox: {
    width: "100%",
    maxWidth: 440,
    backgroundColor: "#1e293b",
    borderRadius: 20,
    padding: 24,
    borderWidth: 1,
    borderColor: "#334155",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.5,
    shadowRadius: 20,
    elevation: 10,
  },
  header: {
    alignItems: "center",
    marginBottom: 20,
  },
  iconCircle: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: "#312e81",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 12,
  },
  title: {
    fontSize: 20,
    fontWeight: "700",
    color: "#f8fafc",
    marginBottom: 6,
  },
  subtitle: {
    fontSize: 13,
    color: "#94a3b8",
    textAlign: "center",
    lineHeight: 18,
    paddingHorizontal: 8,
  },
  formContainer: {
    gap: 12,
  },
  inputLabel: {
    fontSize: 13,
    fontWeight: "600",
    color: "#cbd5e1",
  },
  codeInput: {
    backgroundColor: "#0f172a",
    borderWidth: 1,
    borderColor: "#475569",
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 20,
    fontWeight: "700",
    letterSpacing: 4,
    textAlign: "center",
    color: "#f8fafc",
    fontFamily: "monospace",
  },
  primaryBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: "#4f46e5",
    paddingVertical: 14,
    borderRadius: 12,
    marginTop: 4,
  },
  btnDisabled: {
    backgroundColor: "#334155",
    opacity: 0.6,
  },
  primaryBtnText: {
    fontSize: 15,
    fontWeight: "600",
    color: "#ffffff",
  },
  dividerRow: {
    flexDirection: "row",
    alignItems: "center",
    marginVertical: 4,
    gap: 10,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: "#334155",
  },
  dividerText: {
    fontSize: 12,
    color: "#64748b",
  },
  secondaryBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    backgroundColor: "#0f172a",
    borderWidth: 1,
    borderColor: "#334155",
    paddingVertical: 12,
    borderRadius: 12,
  },
  secondaryBtnText: {
    fontSize: 13,
    fontWeight: "500",
    color: "#94a3b8",
  },
  userCard: {
    backgroundColor: "#0f172a",
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: "#334155",
    marginBottom: 6,
  },
  userCardTitle: {
    fontSize: 12,
    color: "#64748b",
    marginBottom: 4,
  },
  userCardName: {
    fontSize: 18,
    fontWeight: "700",
    color: "#f8fafc",
    marginBottom: 2,
  },
  userCardId: {
    fontSize: 12,
    color: "#818cf8",
    fontFamily: "monospace",
  },
  footerTip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 18,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: "#334155",
  },
  footerTipText: {
    flex: 1,
    fontSize: 11,
    color: "#64748b",
    lineHeight: 15,
  },
});
