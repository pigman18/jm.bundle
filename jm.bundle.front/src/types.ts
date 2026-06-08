export interface Comic {
  number: number
  title: string
  author?: string
  cover?: string
  tags?: string[]
  kind?: string
  displayKindLabel?: string
  pages?: number
  publishDate?: string
  updateDate?: string
  watchQty?: number
  likeQty?: number
  intro?: string
  keywords?: string
  publisher?: string
  canRead?: boolean
  episodes?: ComicEpisode[]
}

export interface ComicEpisode {
  number: number
  title?: string
}

export interface ZipStatus {
  exists?: boolean
  download?: DownloadStatus
}

export interface DownloadStatus {
  status?: 'waiting' | 'start' | 'running' | 'done' | 'error'
  step?: string
  stepState?: string
  complete?: number
  total?: number
  error?: string
}

export interface TaskItem {
  id: number
  number: number
  name?: string
  url?: string
  status: string
  progress: number
  speed: number
  downloadedSize: number
  totalSize: number
  labels?: string[]
  dir?: string
  error?: string
  step?: string | null
  stepState?: string | null
  stepStatus?: { label: string; icon: string; color: string } | null
  coverBase64?: string
  displayTitle?: string
  episodeNumber?: number
  addedDate: number
  completedDate?: number
}
