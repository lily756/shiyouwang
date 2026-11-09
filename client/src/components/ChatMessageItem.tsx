import React, { useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, Image } from "react-native";
import { ClientMessage } from "../types";
import { API_BASE } from "../api";
import { Ionicons } from "@expo/vector-icons";

interface Props {
  message: ClientMessage;
  roleName: string;
  avatarUrl?: string | null;
}

export const ChatMessageItem: React.FC<Props> = ({ message, roleName, avatarUrl }) => {
  const isUser = message.role === "user";
  const [showThinking, setShowThinking] = useState(false);

  return (
    <View style={[styles.container, isUser ? styles.containerUser : styles.containerAssistant]}>
      {/* Avatar for assistant */}
      {!isUser && (
        <View style={styles.avatarWrapper}>
          {avatarUrl ? (
            <Image source={{ uri: avatarUrl }} style={styles.avatar} />
          ) : (
            <View style={[styles.avatar, styles.avatarPlaceholder]}>
              <Text style={styles.avatarText}>{roleName.slice(0, 1)}</Text>
            </View>
          )}
        </View>
      )}

      <View style={[styles.bubble, isUser ? styles.bubbleUser : styles.bubbleAssistant]}>
        {/* Assistant Header Name */}
        {!isUser && <Text style={styles.senderName}>{roleName}</Text>}

        {/* Collapsible Thinking Block */}
        {!isUser && message.thinking ? (
          <View style={styles.thinkingContainer}>
            <TouchableOpacity
              style={styles.thinkingHeader}
              onPress={() => setShowThinking((prev) => !prev)}
              activeOpacity={0.7}
            >
              <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
                <Ionicons name="bulb-outline" size={13} color="#a5b4fc" />
                <Text style={styles.thinkingHeaderText}>
                  {showThinking ? "收起思考过程" : "查看思考过程 (Thinking)"}
                </Text>
              </View>
              <Ionicons
                name={showThinking ? "chevron-up" : "chevron-down"}
                size={14}
                color="#a5b4fc"
              />
            </TouchableOpacity>

            {showThinking && (
              <View style={styles.thinkingBody}>
                <Text style={styles.thinkingText}>{message.thinking}</Text>
              </View>
            )}
          </View>
        ) : null}

        {/* Message Text */}
        {message.text ? (
          <Text style={[styles.messageText, isUser ? styles.textUser : styles.textAssistant]}>
            {message.text}
          </Text>
        ) : null}

        {/* Media Preview if attached */}
        {message.media && message.media.length > 0 && (
          <View style={styles.mediaContainer}>
            {message.media.map((item, idx) =>
              item.url ? (
                <Image
                  key={idx}
                  source={{
                    uri: item.url.startsWith("http") ? item.url : `${API_BASE}${item.url}`,
                  }}
                  style={styles.attachedImage}
                  resizeMode="cover"
                />
              ) : null
            )}
          </View>
        )}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flexDirection: "row",
    marginVertical: 6,
    paddingHorizontal: 12,
  },
  containerUser: {
    justifyContent: "flex-end",
  },
  containerAssistant: {
    justifyContent: "flex-start",
  },
  avatarWrapper: {
    marginRight: 8,
    alignSelf: "flex-start",
    marginTop: 2,
  },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "#334155",
  },
  avatarPlaceholder: {
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#4f46e5",
  },
  avatarText: {
    color: "#ffffff",
    fontWeight: "700",
    fontSize: 15,
  },
  bubble: {
    maxWidth: "80%",
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  bubbleUser: {
    backgroundColor: "#4f46e5",
    borderBottomRightRadius: 4,
  },
  bubbleAssistant: {
    backgroundColor: "#1e293b",
    borderBottomLeftRadius: 4,
    borderWidth: 1,
    borderColor: "#334155",
  },
  senderName: {
    fontSize: 11,
    fontWeight: "600",
    color: "#818cf8",
    marginBottom: 4,
  },
  messageText: {
    fontSize: 15,
    lineHeight: 22,
  },
  textUser: {
    color: "#ffffff",
  },
  textAssistant: {
    color: "#f1f5f9",
  },
  thinkingContainer: {
    backgroundColor: "#0f172a",
    borderRadius: 10,
    marginBottom: 8,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "#312e81",
  },
  thinkingHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: "#1e1b4b",
  },
  thinkingHeaderText: {
    fontSize: 11,
    fontWeight: "600",
    color: "#c7d2fe",
  },
  thinkingBody: {
    padding: 10,
  },
  thinkingText: {
    fontSize: 12,
    color: "#94a3b8",
    lineHeight: 18,
    fontFamily: "monospace",
  },
  mediaContainer: {
    marginTop: 8,
    borderRadius: 10,
    overflow: "hidden",
  },
  attachedImage: {
    width: 240,
    height: 180,
    borderRadius: 8,
    backgroundColor: "#0f172a",
  },
});
