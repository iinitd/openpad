import type { BackendAttachment } from "../backend";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { View, Text, StyleSheet, Linking } from "react-native";
import { WebView, type WebViewMessageEvent } from "react-native-webview";
import { useWebPreviewStore } from "./web-preview-store";
import { buildWebPreviewHtml } from "./html";
import { THEME } from "../styles/theme";
import { DocumentCommentBar } from "../editor/DocumentCommentBar";
import { useEditorStore } from "../stores/editor-store";
import { sendPreviewComment } from "./preview-comment";
import type { WebPreviewProps } from "./WebPreview";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useFilesStore } from "../stores/files-store";
import { createPreviewStateScope, readPreviewState, writePreviewState } from "./preview-state";

export function WebPreview({ hideInlineCommentBar, active = true }: WebPreviewProps) {
  const snapshot=useWebPreviewStore(state=>state.snapshot);
  const error=useWebPreviewStore(state=>state.error);
  const loading=useWebPreviewStore(state=>state.loading);
  const html=useMemo(()=>snapshot?buildWebPreviewHtml(snapshot):"",[snapshot]);
  const webViewRef=useRef<WebView>(null);
  const [selectionText,setSelectionText]=useState<string|null>(null);
  const setCommentBridge=useEditorStore(state=>state.setCommentBridge);
  const cwd=useFilesStore(state=>state.cwd);
  const stateScope=useMemo(()=>createPreviewStateScope(cwd||"",snapshot?.rootPath||""),[cwd,snapshot?.rootPath]);
  const command=useCallback((javascript:string)=>webViewRef.current?.injectJavaScript(`${javascript};true;`),[]);
  const clearSelection=useCallback(()=>{setSelectionText(null);command("window.__kelPreviewClearSelection&&window.__kelPreviewClearSelection()")},[command]);
  const send=useCallback(async(comment:string,attachments?:BackendAttachment[])=>{await sendPreviewComment(comment,selectionText,attachments);clearSelection()},[clearSelection,selectionText]);
  const deliverState=useCallback((message:unknown)=>command(`window.__kelPreviewStateMessage&&window.__kelPreviewStateMessage(${JSON.stringify(message).replace(/</g,"\u003c")})`),[command]);
  const onMessage=(event:WebViewMessageEvent)=>{try{const message=JSON.parse(event.nativeEvent.data);if(message.type==="external"&&typeof message.url==="string")void Linking.openURL(message.url);if(message.type==="selection"&&active)setSelectionText(typeof message.text==="string"?message.text:null);if(message.type==="preview-state-get"&&typeof message.requestId==="string"&&typeof message.key==="string")void readPreviewState(AsyncStorage,stateScope,message.key).then(value=>deliverState({command:"preview-state-value",requestId:message.requestId,value}));if(message.type==="preview-state-set"&&typeof message.requestId==="string"&&typeof message.key==="string")void writePreviewState(AsyncStorage,stateScope,message.key,message.value).then(ok=>deliverState({command:"preview-state-set-result",requestId:message.requestId,ok}))}catch{}};
  useEffect(()=>{if(!hideInlineCommentBar)return;setCommentBridge({selectionText,onSend:send,onClearSelection:selectionText?clearSelection:undefined});return()=>setCommentBridge(null)},[clearSelection,hideInlineCommentBar,selectionText,send,setCommentBridge]);
  useEffect(()=>setSelectionText(null),[snapshot?.fingerprint]);
  return (
    <View style={styles.container}>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {snapshot ? (
        <WebView
          ref={webViewRef}
          key={snapshot.fingerprint}
          source={{ html }}
          originWhitelist={["*"]}
          javaScriptEnabled
          domStorageEnabled
          onMessage={onMessage}
          onShouldStartLoadWithRequest={(request) => {
            if (request.url === "about:blank" || request.url.startsWith("data:")) return true;
            if (/^https?:/i.test(request.url) && request.navigationType === "click") {
              void Linking.openURL(request.url);
              return false;
            }
            return true;
          }}
          style={styles.webview}
        />
      ) : (
        <View style={styles.empty}>
          <Text style={styles.muted}>
            {loading ? "Loading preview…" : "preview/index.html unavailable"}
          </Text>
        </View>
      )}
      {hideInlineCommentBar ? null : (
        <DocumentCommentBar
          selectionText={selectionText}
          onSend={send}
          onClearSelection={selectionText ? clearSelection : undefined}
        />
      )}
    </View>
  );
}
const styles = StyleSheet.create({
  container: { flex: 1, minHeight: 0, backgroundColor: "#fff" },
  muted: {
    fontSize: 13,
    color: THEME.colors.textMuted,
    textAlign: "center",
  },
  error: { padding: 6, color: THEME.colors.error, backgroundColor: "#fff1f2", fontSize: 12 },
  empty: { flex: 1, alignItems: "center", justifyContent: "center" },
  webview: { flex: 1, backgroundColor: "#fff" },
});
