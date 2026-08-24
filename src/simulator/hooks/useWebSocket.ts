import { useEffect, useRef } from 'react'
import { useDeviceStore } from '../store/useDeviceStore'
import type { WsMessage } from '../types'

export function useWebSocket() {
  const wsRef = useRef<WebSocket | null>(null)
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  // 组件已卸载标记：卸载后 onclose 不得再排重连，否则每次切页泄漏一条连接，
  // 服务端每条广播会被重复入库 N 次（日志面板出现同秒重复条目）
  const disposedRef = useRef(false)
  const { handleWsMessage, setWsConnected } = useDeviceStore()

  function connect() {
    // 走 vite proxy：/simws → ws://localhost:3001/ws（见 vite.config.ts），不直连 3001 端口
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const wsUrl = `${protocol}//${window.location.host}/simws`

    const ws = new WebSocket(wsUrl)
    wsRef.current = ws

    ws.onopen = () => {
      setWsConnected(true)
      if (reconnectTimer.current) {
        clearTimeout(reconnectTimer.current)
        reconnectTimer.current = null
      }
    }

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data) as WsMessage
        handleWsMessage(msg)
      } catch {
        // ignore malformed messages
      }
    }

    ws.onclose = () => {
      setWsConnected(false)
      if (disposedRef.current) return
      // 5s 后重连
      reconnectTimer.current = setTimeout(() => {
        connect()
      }, 5000)
    }

    ws.onerror = () => {
      ws.close()
    }
  }

  useEffect(() => {
    disposedRef.current = false
    connect()
    return () => {
      disposedRef.current = true
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current)
      wsRef.current?.close()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return wsRef
}
