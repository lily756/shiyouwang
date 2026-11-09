import React, { useState } from "react";
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
} from "react-native";
import { RuntimeState, AffectiveState, ScheduleData } from "../types";
import { Ionicons } from "@expo/vector-icons";

interface Props {
  visible: boolean;
  roleName: string;
  isSleeping: boolean;
  runtimeState: RuntimeState | null;
  affectiveState: AffectiveState | null;
  schedule: ScheduleData | null;
  loading: boolean;
  onWakeCaffeine: () => void;
  onClose: () => void;
}

export const StateDrawer: React.FC<Props> = ({
  visible,
  roleName,
  isSleeping,
  runtimeState,
  affectiveState,
  schedule,
  loading,
  onWakeCaffeine,
  onClose,
}) => {
  const [activeTab, setActiveTab] = useState<"life" | "affect" | "schedule">("life");

  const renderProgressBar = (label: string, value: number, color: string, max = 100) => {
    const clamped = Math.min(max, Math.max(0, value || 0));
    const percent = Math.round((clamped / max) * 100);
    return (
      <View style={styles.meterContainer} key={label}>
        <View style={styles.meterHeader}>
          <Text style={styles.meterLabel}>{label}</Text>
          <Text style={[styles.meterValue, { color }]}>{clamped}</Text>
        </View>
        <View style={styles.meterTrack}>
          <View style={[styles.meterFill, { width: `${percent}%`, backgroundColor: color }]} />
        </View>
      </View>
    );
  };

  return (
    <Modal visible={visible} animationType="slide" transparent={true} onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.container}>
          {/* Header */}
          <View style={styles.header}>
            <View>
              <Text style={styles.title}>「{roleName}」状态与心智看板</Text>
              <Text style={styles.subtitle}>实时生活动态、六维情感与全天日程</Text>
            </View>
            <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
              <Ionicons name="close" size={22} color="#94a3b8" />
            </TouchableOpacity>
          </View>

          {/* Tabs */}
          <View style={styles.tabBar}>
            <TouchableOpacity
              style={[styles.tabItem, activeTab === "life" && styles.tabItemActive]}
              onPress={() => setActiveTab("life")}
            >
              <Text style={[styles.tabText, activeTab === "life" && styles.tabTextActive]}>
                生活状态
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.tabItem, activeTab === "affect" && styles.tabItemActive]}
              onPress={() => setActiveTab("affect")}
            >
              <Text style={[styles.tabText, activeTab === "affect" && styles.tabTextActive]}>
                六维情感与健康
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.tabItem, activeTab === "schedule" && styles.tabItemActive]}
              onPress={() => setActiveTab("schedule")}
            >
              <Text style={[styles.tabText, activeTab === "schedule" && styles.tabTextActive]}>
                今日日程 ({schedule?.entries?.length || 0})
              </Text>
            </TouchableOpacity>
          </View>

          {loading ? (
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="large" color="#6366f1" />
              <Text style={styles.loadingText}>正在同步角色心智状态...</Text>
            </View>
          ) : (
            <ScrollView style={styles.content} contentContainerStyle={{ paddingBottom: 30 }}>
              {/* Tab 1: Life State */}
              {activeTab === "life" && (
                <View>
                  {isSleeping && (
                    <View style={styles.alertBanner}>
                      <View style={{ flex: 1, flexDirection: "row", alignItems: "center", gap: 8 }}>
                        <Text style={{ fontSize: 20 }}>🌙</Text>
                        <Text style={styles.alertText}>角色当前正处于睡眠/小憩时段</Text>
                      </View>
                      <TouchableOpacity style={styles.caffeineBtn} onPress={onWakeCaffeine}>
                        <Ionicons name="cafe" size={15} color="#fff" />
                        <Text style={styles.caffeineBtnText}>喝咖啡叫醒</Text>
                      </TouchableOpacity>
                    </View>
                  )}

                  <View style={styles.card}>
                    <Text style={styles.cardTitle}>当前正在做什么</Text>
                    <Text style={styles.activityMain}>
                      {runtimeState?.activity || "自由安排中"}
                    </Text>

                    <View style={styles.infoRow}>
                      <Text style={styles.infoLabel}>当前地点：</Text>
                      <Text style={styles.infoVal}>{runtimeState?.location || "未知"}</Text>
                    </View>

                    {runtimeState?.environment ? (
                      <View style={styles.infoRow}>
                        <Text style={styles.infoLabel}>所处环境：</Text>
                        <Text style={styles.infoVal}>{runtimeState.environment}</Text>
                      </View>
                    ) : null}

                    {runtimeState?.outfit ? (
                      <View style={styles.infoRow}>
                        <Text style={styles.infoLabel}>当前穿着：</Text>
                        <Text style={styles.infoVal}>{runtimeState.outfit}</Text>
                      </View>
                    ) : null}

                    {runtimeState?.carriedItems && runtimeState.carriedItems.length > 0 ? (
                      <View style={styles.infoRow}>
                        <Text style={styles.infoLabel}>随身物品：</Text>
                        <Text style={styles.infoVal}>
                          {runtimeState.carriedItems.join("、")}
                        </Text>
                      </View>
                    ) : null}

                    {runtimeState?.mood ? (
                      <View style={styles.infoRow}>
                        <Text style={styles.infoLabel}>当前心情：</Text>
                        <Text style={styles.infoVal}>{runtimeState.mood}</Text>
                      </View>
                    ) : null}
                  </View>
                </View>
              )}

              {/* Tab 2: Affect & Health */}
              {activeTab === "affect" && (
                <View>
                  {affectiveState?.reason ? (
                    <View style={styles.reasonCard}>
                      <Text style={styles.reasonTitle}>💡 最近心智波动原因：</Text>
                      <Text style={styles.reasonText}>{affectiveState.reason}</Text>
                    </View>
                  ) : null}

                  <View style={styles.card}>
                    <Text style={styles.cardTitle}>六维情感 (短期情绪 / 长期基线)</Text>
                    {affectiveState?.shortTerm && (
                      <>
                        {renderProgressBar("愉悦度 (Valence)", affectiveState.shortTerm.valence, "#10b981")}
                        {renderProgressBar("唤醒度 (Arousal)", affectiveState.shortTerm.arousal, "#f59e0b")}
                        {renderProgressBar("亲近度 (Closeness)", affectiveState.shortTerm.closeness, "#ec4899")}
                        {renderProgressBar("信任度 (Trust)", affectiveState.shortTerm.trust, "#6366f1")}
                        {renderProgressBar("安全感 (Security)", affectiveState.shortTerm.security, "#3b82f6")}
                        {renderProgressBar("压力值 (Stress)", affectiveState.shortTerm.stress, "#ef4444")}
                      </>
                    )}
                  </View>

                  <View style={styles.card}>
                    <Text style={styles.cardTitle}>身体机能与健康指标</Text>
                    {affectiveState?.body && (
                      <>
                        {renderProgressBar("总体健康 (Health)", affectiveState.body.health, "#10b981")}
                        {renderProgressBar("疲劳程度 (Fatigue)", affectiveState.body.fatigue, "#f97316")}
                        {renderProgressBar("困倦程度 (Sleepiness)", affectiveState.body.sleepiness, "#a855f7")}
                        {renderProgressBar("疼痛负担 (Pain)", affectiveState.body.pain, "#ef4444")}
                      </>
                    )}
                  </View>
                </View>
              )}

              {/* Tab 3: Schedule Timeline */}
              {activeTab === "schedule" && (
                <View>
                  {schedule?.entries && schedule.entries.length > 0 ? (
                    <View style={styles.timelineList}>
                      {schedule.entries.map((entry, idx) => {
                        const isSleep = entry.kind === "sleep" || entry.kind === "nap";
                        const isMeal = entry.kind === "meal";
                        const isMove = entry.kind === "commute" || entry.kind === "prepare";

                        const formatMin = (min?: number, fallback = "") => {
                          if (typeof min !== "number" || isNaN(min)) return fallback;
                          const h = Math.floor(min / 60).toString().padStart(2, "0");
                          const m = (min % 60).toString().padStart(2, "0");
                          return `${h}:${m}`;
                        };
                        const startTime = entry.start || formatMin(entry.startMinute, "00:00");
                        const endTime = entry.end || formatMin(entry.endMinute, "24:00");

                        return (
                          <View key={idx} style={styles.timelineItem}>
                            <View style={styles.timelineTimeCol}>
                              <Text style={styles.timelineTimeText}>
                                {startTime} - {endTime}
                              </Text>
                              <View
                                style={[
                                  styles.kindBadge,
                                  isSleep && { backgroundColor: "#312e81" },
                                  isMeal && { backgroundColor: "#78350f" },
                                  isMove && { backgroundColor: "#334155" },
                                ]}
                              >
                                <Text style={styles.kindBadgeText}>{entry.kind}</Text>
                              </View>
                            </View>

                            <View style={styles.timelineDotLine}>
                              <View style={styles.timelineDot} />
                              {idx < schedule.entries.length - 1 && <View style={styles.timelineLine} />}
                            </View>

                            <View style={styles.timelineContentCol}>
                              <Text style={styles.timelineActivity}>{entry.activity}</Text>
                              {entry.location ? (
                                <Text style={styles.timelineLocation}>
                                  📍 {entry.location}
                                  {entry.environment ? ` · ${entry.environment}` : ""}
                                </Text>
                              ) : null}
                            </View>
                          </View>
                        );
                      })}
                    </View>
                  ) : (
                    <View style={styles.emptyContainer}>
                      <Text style={styles.emptyText}>今天尚未生成日程计划</Text>
                    </View>
                  )}
                </View>
              )}
            </ScrollView>
          )}
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
    maxHeight: "88%",
    paddingTop: 16,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    paddingHorizontal: 20,
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: "#334155",
  },
  title: {
    fontSize: 17,
    fontWeight: "700",
    color: "#f8fafc",
  },
  subtitle: {
    fontSize: 12,
    color: "#94a3b8",
    marginTop: 2,
  },
  closeBtn: {
    padding: 4,
  },
  tabBar: {
    flexDirection: "row",
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: "#334155",
    gap: 8,
  },
  tabItem: {
    flex: 1,
    paddingVertical: 8,
    alignItems: "center",
    borderRadius: 10,
    backgroundColor: "#0f172a",
  },
  tabItemActive: {
    backgroundColor: "#4f46e5",
  },
  tabText: {
    fontSize: 12,
    fontWeight: "600",
    color: "#94a3b8",
  },
  tabTextActive: {
    color: "#ffffff",
  },
  content: {
    paddingHorizontal: 16,
    paddingTop: 14,
  },
  loadingContainer: {
    padding: 40,
    alignItems: "center",
    gap: 12,
  },
  loadingText: {
    color: "#94a3b8",
    fontSize: 14,
  },
  alertBanner: {
    backgroundColor: "#312e81",
    borderRadius: 14,
    padding: 12,
    marginBottom: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  alertText: {
    color: "#e0e7ff",
    fontSize: 13,
    fontWeight: "500",
  },
  caffeineBtn: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#4f46e5",
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    gap: 4,
  },
  caffeineBtnText: {
    color: "#ffffff",
    fontSize: 12,
    fontWeight: "600",
  },
  card: {
    backgroundColor: "#0f172a",
    borderRadius: 16,
    padding: 16,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: "#334155",
  },
  cardTitle: {
    fontSize: 14,
    fontWeight: "700",
    color: "#e2e8f0",
    marginBottom: 12,
  },
  activityMain: {
    fontSize: 16,
    fontWeight: "600",
    color: "#818cf8",
    lineHeight: 22,
    marginBottom: 10,
  },
  infoRow: {
    flexDirection: "row",
    marginTop: 6,
  },
  infoLabel: {
    fontSize: 13,
    color: "#94a3b8",
    width: 76,
  },
  infoVal: {
    fontSize: 13,
    color: "#f1f5f9",
    flex: 1,
  },
  reasonCard: {
    backgroundColor: "#172554",
    borderColor: "#1e3a8a",
    borderWidth: 1,
    borderRadius: 14,
    padding: 12,
    marginBottom: 14,
  },
  reasonTitle: {
    fontSize: 12,
    fontWeight: "600",
    color: "#93c5fd",
    marginBottom: 4,
  },
  reasonText: {
    fontSize: 13,
    color: "#dbeafe",
    lineHeight: 18,
  },
  meterContainer: {
    marginBottom: 10,
  },
  meterHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 4,
  },
  meterLabel: {
    fontSize: 12,
    color: "#94a3b8",
  },
  meterValue: {
    fontSize: 12,
    fontWeight: "700",
  },
  meterTrack: {
    height: 7,
    backgroundColor: "#1e293b",
    borderRadius: 4,
    overflow: "hidden",
  },
  meterFill: {
    height: "100%",
    borderRadius: 4,
  },
  timelineList: {
    paddingVertical: 6,
  },
  timelineItem: {
    flexDirection: "row",
    marginBottom: 14,
  },
  timelineTimeCol: {
    width: 86,
    alignItems: "flex-end",
    paddingRight: 10,
  },
  timelineTimeText: {
    fontSize: 11,
    fontWeight: "600",
    color: "#94a3b8",
  },
  kindBadge: {
    backgroundColor: "#1e293b",
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
    marginTop: 4,
  },
  kindBadgeText: {
    fontSize: 10,
    color: "#cbd5e1",
  },
  timelineDotLine: {
    alignItems: "center",
    width: 16,
  },
  timelineDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: "#6366f1",
    marginTop: 4,
  },
  timelineLine: {
    width: 2,
    flex: 1,
    backgroundColor: "#334155",
    marginTop: 4,
  },
  timelineContentCol: {
    flex: 1,
    paddingLeft: 10,
  },
  timelineActivity: {
    fontSize: 14,
    fontWeight: "600",
    color: "#f8fafc",
    lineHeight: 19,
  },
  timelineLocation: {
    fontSize: 12,
    color: "#94a3b8",
    marginTop: 3,
  },
  emptyContainer: {
    padding: 30,
    alignItems: "center",
  },
  emptyText: {
    color: "#64748b",
    fontSize: 14,
  },
});
