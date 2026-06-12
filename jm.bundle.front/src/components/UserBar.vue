<template>
  <span v-if="memberInfo" class="jmz-user-info">{{ memberInfo.username }}<span class="jmz-user-level">{{ memberInfo.level_name }}</span></span>
  <n-button text size="small" class="jmz-header-btn" @click="doSign" :loading="signLoading" :disabled="signLoading">签到</n-button>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useMessage } from 'naive-ui'
import { getJson, postJson } from '@/api'

const message = useMessage()

const memberInfo = ref<any>(null)
const signLoading = ref(false)

onMounted(async () => {
  try {
    const j = await getJson('/settings')
    if (j.ok && j.bundleConfig?.memberInfo) {
      memberInfo.value = j.bundleConfig.memberInfo
    }
  } catch { /* ignore */ }
})

async function doSign() {
  signLoading.value = true
  try {
    const j = await postJson('/account/sign')
    if (j.ok) {
      message.success(j.msg || '签到成功')
      const s = await getJson('/settings')
      if (s.ok && s.bundleConfig?.memberInfo) {
        memberInfo.value = s.bundleConfig.memberInfo
      }
    } else {
      message.error(j.message || '签到失败')
    }
  } catch (e: any) {
    message.error(e.message || '签到失败')
  } finally {
    signLoading.value = false
  }
}
</script>

<style scoped>
.jmz-user-info {
  font-size: 12px;
  color: #9b9bb4;
  display: flex;
  align-items: center;
  gap: 4px;
  white-space: nowrap;
}
.jmz-user-level {
  color: #7a7a8a;
  font-size: 11px;
}
</style>
