<template>
  <n-config-provider :locale="zhCN" :date-locale="dateZhCN" :theme="darkTheme" :theme-overrides="themeOverrides">
    <n-global-style />
    <n-message-provider>
      <n-dialog-provider>
      <div id="jm-app-root">
        <header class="jmz-app-header">
          <div class="jmz-app-header-inner">
            <n-button text size="small" class="jmz-app-back" v-if="isDetail" @click="backToCatalog">
              <template #icon><n-icon :component="ArrowBack" /></template>
              目录
            </n-button>
            <img src="/icon.ico" class="jmz-app-logo" alt="" />
            <span class="jmz-app-title">JM</span>
            <span class="jmz-app-badge" v-if="store.syncLocalToDb.busy">同步中</span>
            <span class="jmz-app-badge jmz-app-badge--ok" v-if="store.syncLocalToDb.complete > 0">sync {{ store.syncLocalToDb.complete }}/{{ store.syncLocalToDb.total }}</span>
            <template v-if="!isDetail">
              <n-button size="tiny" quaternary @click="goCatalogAndSync('local2db')" :disabled="store.syncLocalToDb.busy">
                <template #icon><n-icon :component="CloudUploadOutline" /></template>local→库
              </n-button>
              <n-button size="tiny" quaternary @click="goCatalogAndSync('db2local')" :disabled="store.syncDbToLocal.busy">
                <template #icon><n-icon :component="CloudDownloadOutline" /></template>库→local
              </n-button>
            </template>
            <div style="flex:1;min-width:0"></div>
            <n-button text size="small" @click="openTasks">
              <template #icon><n-icon :component="ListOutline" /></template>任务
              <template v-if="live.queueCount > 0">&nbsp;({{ live.queueCount }})</template>
            </n-button>
          </div>
        </header>
        <main class="jmz-app-main">
          <router-view v-slot="{ Component }">
            <keep-alive :include="['CatalogPage']">
              <component :is="Component" />
            </keep-alive>
          </router-view>
        </main>
        <TasksDialog v-model:show="showTasks" />
      </div>
      </n-dialog-provider>
    </n-message-provider>
  </n-config-provider>
</template>

<script setup lang="ts">
import { ref, computed, provide, onMounted, onUnmounted } from 'vue'
import { zhCN, dateZhCN, darkTheme } from 'naive-ui'
import { ArrowBack, CloudUploadOutline, CloudDownloadOutline, ListOutline } from '@vicons/ionicons5'
import { useRoute, useRouter } from 'vue-router'
import { useJmLiveStore } from '@/stores/jmLive'
import { useJmTasksStore } from '@/stores/jmTasks'
import { API } from '@/constants'
import { postJson } from '@/api'
import TasksDialog from '@/components/TasksDialog.vue'
import { peekCatalogReturnQuery } from '@/utils/catalogReturn'

const route = useRoute()
const router = useRouter()
const store = useJmLiveStore()
const live = useJmLiveStore()
const tasksStore = useJmTasksStore()
const showTasks = ref(false)
const isDetail = computed(() => route.name === 'detail')
provide('jmzOpenTasks', () => { showTasks.value = true })
provide('sendWs', (msg: string) => { try { ws?.send(msg) } catch {} })

function openTasks() { showTasks.value = true }
function backToCatalog() { router.push({ name: 'catalog', query: peekCatalogReturnQuery() }) }
async function syncApi(dir: 'local2db' | 'db2local') {
  try { await postJson(`/sync/${dir}`) } catch { /* ignore */ }
}

const themeOverrides = {
  common: {
    primaryColor: '#2563eb',
    primaryColorHover: '#3b82f6',
    primaryColorPressed: '#1d4ed8',
  },
}

let ws: WebSocket | null = null
let pingTimer: ReturnType<typeof setInterval> | null = null
let reconnectTimer: ReturnType<typeof setTimeout> | null = null

function connectWs() {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:'
  const host = location.host
  const url = `${proto}//${host}${API}/ws`
  ws = new WebSocket(url)

  ws.onmessage = (e) => {
    try {
      const msg = JSON.parse(e.data)
      // 旧协议（同步等）→ jmLive
      store.ingestWsPayload(msg)
      // task-manager 协议 → jmTasks
      if (msg.type && ['init','added','removed','progress','completed','error','paused','started'].includes(msg.type)) {
        tasksStore.handleWsMessage(msg)
      }
    } catch { /* ignore */ }
  }

  ws.onclose = () => {
    if (pingTimer) { clearInterval(pingTimer); pingTimer = null }
    ws = null
    reconnectTimer = setTimeout(connectWs, 3000)
  }

  ws.onopen = () => {
    if (pingTimer) clearInterval(pingTimer)
    pingTimer = setInterval(() => {
      try { ws?.send(JSON.stringify({ type: 'ping' })) } catch { /* ignore */ }
    }, 15000)
  }
}

onMounted(() => connectWs())

onUnmounted(() => {
  if (pingTimer) clearInterval(pingTimer)
  if (reconnectTimer) clearTimeout(reconnectTimer)
  ws?.close()
})
</script>

<style>
#jm-app-root {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
}

.jmz-app-header {
  position: sticky;
  top: 0;
  z-index: 1000;
  background: rgba(30, 30, 34, 0.88);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  border-bottom: 1px solid rgba(46, 46, 53, 0.9);
}

.jmz-app-header-inner {
  max-width: 1400px;
  margin: 0 auto;
  padding: 8px 16px;
  display: flex;
  align-items: center;
  gap: 12px;
}

.jmz-app-back {
  color: #9b9bb4 !important;
}
.jmz-app-back:hover {
  color: #c4c4d6 !important;
}

.jmz-app-logo {
  width: 20px;
  height: 20px;
  border-radius: 4px;
  flex-shrink: 0;
}
.jmz-app-title {
  font-size: 18px;
  font-weight: 700;
  color: #e0e0e6;
  letter-spacing: -0.02em;
}

.jmz-app-badge {
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 6px;
  background: #2e2e35;
  color: #c4c4d6;
}

.jmz-app-badge--ok {
  background: #1a3a2a;
  color: #5ee0a0;
}

.jmz-app-main {
  flex: 1;
}
</style>
