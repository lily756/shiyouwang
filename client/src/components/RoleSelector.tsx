import React from "react";
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  Image,
} from "react-native";
import { Role } from "../types";
import { API_BASE } from "../api";
import { Ionicons } from "@expo/vector-icons";

interface Props {
  visible: boolean;
  roles: Role[];
  activeRoleName: string;
  onSelectRole: (role: Role) => void;
  onClose: () => void;
}

export const RoleSelector: React.FC<Props> = ({
  visible,
  roles,
  activeRoleName,
  onSelectRole,
  onClose,
}) => {
  return (
    <Modal visible={visible} animationType="slide" transparent={true} onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.container}>
          <View style={styles.header}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <Ionicons name="people" size={20} color="#6366f1" />
              <Text style={styles.title}>选择对话角色</Text>
            </View>
            <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
              <Ionicons name="close" size={22} color="#94a3b8" />
            </TouchableOpacity>
          </View>

          <ScrollView style={styles.list} contentContainerStyle={{ paddingBottom: 20 }}>
            {roles.map((role) => {
              const isActive = role.name === activeRoleName;
              return (
                <TouchableOpacity
                  key={role.id || role.name}
                  style={[styles.roleCard, isActive && styles.roleCardActive]}
                  onPress={() => onSelectRole(role)}
                  activeOpacity={0.7}
                >
                  <View style={styles.avatarContainer}>
                    {role.avatarUrl ? (
                      <Image
                        source={{ uri: `${API_BASE}${role.avatarUrl}` }}
                        style={styles.avatar}
                      />
                    ) : (
                      <View style={[styles.avatar, styles.avatarPlaceholder]}>
                        <Text style={styles.avatarInitial}>{role.name.slice(0, 1)}</Text>
                      </View>
                    )}
                    {role.isSleeping && (
                      <View style={styles.sleepBadge}>
                        <Text style={styles.sleepBadgeText}>🌙</Text>
                      </View>
                    )}
                  </View>

                  <View style={styles.roleInfo}>
                    <View style={styles.roleHeaderRow}>
                      <Text style={[styles.roleName, isActive && styles.roleNameActive]}>
                        {role.name}
                      </Text>
                      {isActive && (
                        <View style={styles.activePill}>
                          <Text style={styles.activePillText}>当前对话</Text>
                        </View>
                      )}
                    </View>

                    <Text style={styles.roleDesc} numberOfLines={2}>
                      {role.description || "暂无简介"}
                    </Text>

                    {role.currentActivity ? (
                      <View style={styles.activityRow}>
                        <Ionicons name="location-outline" size={13} color="#6366f1" />
                        <Text style={styles.activityText} numberOfLines={1}>
                          {role.location ? `[${role.location}] ` : ""}
                          {role.currentActivity}
                        </Text>
                      </View>
                    ) : null}
                  </View>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(15, 23, 42, 0.75)",
    justifyContent: "flex-end",
  },
  container: {
    backgroundColor: "#1e293b",
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: "85%",
    paddingTop: 16,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: "#334155",
  },
  title: {
    fontSize: 18,
    fontWeight: "700",
    color: "#f8fafc",
  },
  closeBtn: {
    padding: 4,
  },
  list: {
    paddingHorizontal: 16,
    paddingTop: 12,
  },
  roleCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#0f172a",
    padding: 14,
    borderRadius: 16,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: "#334155",
  },
  roleCardActive: {
    borderColor: "#6366f1",
    backgroundColor: "#1e1b4b",
  },
  avatarContainer: {
    position: "relative",
    marginRight: 14,
  },
  avatar: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: "#334155",
  },
  avatarPlaceholder: {
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#475569",
  },
  avatarInitial: {
    fontSize: 22,
    fontWeight: "700",
    color: "#f8fafc",
  },
  sleepBadge: {
    position: "absolute",
    bottom: -2,
    right: -2,
    backgroundColor: "#0f172a",
    borderRadius: 10,
    paddingHorizontal: 3,
  },
  sleepBadgeText: {
    fontSize: 11,
  },
  roleInfo: {
    flex: 1,
  },
  roleHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 4,
  },
  roleName: {
    fontSize: 16,
    fontWeight: "600",
    color: "#f8fafc",
  },
  roleNameActive: {
    color: "#818cf8",
  },
  activePill: {
    backgroundColor: "#4f46e5",
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
  },
  activePillText: {
    fontSize: 11,
    color: "#ffffff",
    fontWeight: "600",
  },
  roleDesc: {
    fontSize: 13,
    color: "#94a3b8",
    lineHeight: 18,
    marginBottom: 4,
  },
  activityRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  activityText: {
    fontSize: 12,
    color: "#a5b4fc",
    fontWeight: "500",
  },
});
