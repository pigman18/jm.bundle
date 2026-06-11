<template>
  <n-config-provider :locale="zhCN" :date-locale="dateZhCN" :theme="darkTheme" :theme-overrides="themeOverrides">
    <n-global-style />
    <n-message-provider>
      <n-dialog-provider>
      <div id="jm-app-root">
        <header class="jmz-app-header">
          <div class="jmz-app-header-inner">
            <div class="jmz-header-left">
              <n-button text size="small" class="jmz-app-back" v-if="isDetail" @click="backToCatalog">
                <template #icon><n-icon :component="ArrowBack" /></template>
                返回
              </n-button>
              <img src="/icon.ico" class="jmz-app-logo" alt="" />
              <span class="jmz-app-title">JM</span>
            </div>
            <div class="jmz-header-center">
              <template v-if="!isDetail">
                <div class="jmz-header-tabs">
                  <router-link :to="{ name: 'catalog' }" class="jmz-tab" :class="{ 'jmz-tab--active': route.name === 'catalog' }">本地管理</router-link>
                  <router-link :to="{ name: 'search' }" class="jmz-tab" :class="{ 'jmz-tab--active': route.name === 'search' }">漫画搜索</router-link>
                  <router-link :to="{ name: 'week' }" class="jmz-tab" :class="{ 'jmz-tab--active': route.name === 'week' }">每周必看</router-link>
                  <router-link :to="{ name: 'category' }" class="jmz-tab" :class="{ 'jmz-tab--active': route.name === 'category' }">分类排行</router-link>
                </div>
              </template>
            </div>
            <div class="jmz-header-right">
              <template v-if="!isDetail">
                <div class="jmz-header-sync-group">
                  <n-button size="tiny" quaternary @click="syncApi('local2db')" :disabled="store.syncLocalToDb.busy" :loading="store.syncLocalToDb.busy">
                    <template #icon><n-icon :component="CloudUploadOutline" /></template>
                    <span>local→库</span>
                  </n-button>
                  <n-button size="tiny" quaternary @click="syncApi('db2local')" :disabled="store.syncDbToLocal.busy" :loading="store.syncDbToLocal.busy">
                    <template #icon><n-icon :component="CloudDownloadOutline" /></template>
                    <span>库→local</span>
                  </n-button>
                  <span class="jmz-header-sync-progress" v-if="store.syncLocalToDb.complete > 0 || store.syncDbToLocal.complete > 0">
                    {{ store.syncLocalToDb.complete }}/{{ store.syncLocalToDb.total || store.syncDbToLocal.complete }}/{{ store.syncDbToLocal.total }}
                  </span>
                </div>
              </template>
              <n-button text size="small" class="jmz-header-task-btn" @click="openTasks">
                <template #icon><n-icon :component="ListOutline" /></template>
                <span>任务</span>
                <span v-if="live.queueCount > 0" class="jmz-task-badge">{{ live.queueCount }}</span>
              </n-button>
            </div>
          </div>
        </header>
        <main class="jmz-app-main">
          <router-view v-slot="{ Component }">
            <keep-alive :include="['CatalogPage', 'SearchPage', 'WeekPage', 'CategoryPage']">
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
function backToCatalog() {
  if (route.query.from === 'search') {
    router.push({ name: 'search' })
  } else if (route.query.from === 'week') {
    router.push({ name: 'week' })
  } else if (route.query.from === 'category') {
    router.push({ name: 'category' })
  } else {
    router.push({ name: 'catalog', query: peekCatalogReturnQuery() })
  }
}
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
  background: rgba(26, 26, 30, 0.92);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  border-bottom: 1px solid rgba(46, 46, 53, 0.7);
  box-shadow: 0 1px 6px rgba(0, 0, 0, 0.3);
}

.jmz-app-header-inner {
  max-width: 1400px;
  margin: 0 auto;
  padding: 6px 16px;
  display: flex;
  align-items: center;
  gap: 8px;
  height: 48px;
  box-sizing: border-box;
}

.jmz-header-left {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-shrink: 0;
}

.jmz-header-center {
  flex: 1;
  min-width: 0;
  display: flex;
  justify-content: center;
}

.jmz-header-tabs {
  display: flex;
  gap: 2px;
  background: rgba(30, 30, 36, 0.6);
  border-radius: 8px;
  padding: 3px;
  border: 1px solid rgba(46, 46, 53, 0.5);
}

.jmz-tab {
  display: inline-flex;
  align-items: center;
  padding: 5px 16px;
  border-radius: 5px;
  font-size: 13px;
  font-weight: 600;
  color: #7a7a8a;
  text-decoration: none;
  transition: all 0.2s;
  cursor: pointer;
  letter-spacing: 0.02em;
}

.jmz-tab:hover {
  color: #c4c4d6;
}

.jmz-tab--active {
  color: #e0e0e6;
  background: rgba(255, 255, 255, 0.07);
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.2);
}

.jmz-header-right {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

.jmz-header-sync-group {
  display: flex;
  align-items: center;
  gap: 2px;
  background: rgba(46, 46, 53, 0.4);
  border-radius: 8px;
  padding: 2px;
}

.jmz-header-sync-progress {
  font-size: 11px;
  color: #7a7a8a;
  padding: 0 8px;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.jmz-app-back {
  color: #9b9bb4 !important;
}
.jmz-app-back:hover {
  color: #c4c4d6 !important;
}

.jmz-app-logo {
  width: 22px;
  height: 22px;
  border-radius: 5px;
  flex-shrink: 0;
}
.jmz-app-title {
  font-size: 17px;
  font-weight: 800;
  color: #e0e0e6;
  letter-spacing: -0.03em;
}

.jmz-header-task-btn {
  color: #9b9bb4 !important;
}
.jmz-header-task-btn:hover {
  color: #e0e0e6 !important;
}

.jmz-task-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 18px;
  height: 18px;
  padding: 0 5px;
  border-radius: 999px;
  background: #2563eb;
  color: #fff;
  font-size: 11px;
  font-weight: 700;
  line-height: 1;
  margin-left: 2px;
}

.jmz-app-main {
  flex: 1;
}
</style>
