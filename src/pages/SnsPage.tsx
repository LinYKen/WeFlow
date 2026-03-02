import { useEffect, useLayoutEffect, useState, useRef, useCallback } from 'react'
import { RefreshCw, Search, X, Download, FolderOpen, FileJson, FileText, Image, CheckCircle, AlertCircle, Calendar, Users, Info, ChevronLeft, ChevronRight, Shield, ShieldOff } from 'lucide-react'
import JumpToDateDialog from '../components/JumpToDateDialog'
import './SnsPage.scss'
import { SnsPost } from '../types/sns'
import { SnsPostItem } from '../components/Sns/SnsPostItem'
import { SnsFilterPanel } from '../components/Sns/SnsFilterPanel'

interface Contact {
    username: string
    displayName: string
    avatarUrl?: string
    type?: 'friend' | 'former_friend' | 'sns_only'
    postCount: number
}

interface SnsOverviewStats {
    totalPosts: number
    totalFriends: number
    earliestTime: number | null
    latestTime: number | null
}

export default function SnsPage() {
    const [posts, setPosts] = useState<SnsPost[]>([])
    const [loading, setLoading] = useState(false)
    const [hasMore, setHasMore] = useState(true)
    const loadingRef = useRef(false)
    const [overviewStats, setOverviewStats] = useState<SnsOverviewStats>({
        totalPosts: 0,
        totalFriends: 0,
        earliestTime: null,
        latestTime: null
    })
    const [overviewStatsLoading, setOverviewStatsLoading] = useState(false)

    // Filter states
    const [searchKeyword, setSearchKeyword] = useState('')
    const [selectedUsernames, setSelectedUsernames] = useState<string[]>([])
    const [jumpTargetDate, setJumpTargetDate] = useState<Date | undefined>(undefined)

    // Contacts state
    const [contacts, setContacts] = useState<Contact[]>([])
    const [contactSearch, setContactSearch] = useState('')
    const [contactsLoading, setContactsLoading] = useState(false)

    // UI states
    const [showJumpDialog, setShowJumpDialog] = useState(false)
    const [debugPost, setDebugPost] = useState<SnsPost | null>(null)

    // 导出相关状态
    const [showExportDialog, setShowExportDialog] = useState(false)
    const [exportFormat, setExportFormat] = useState<'json' | 'html'>('html')
    const [exportFolder, setExportFolder] = useState('')
    const [exportMedia, setExportMedia] = useState(false)
    const [exportDateRange, setExportDateRange] = useState<{ start: string; end: string }>({ start: '', end: '' })
    const [isExporting, setIsExporting] = useState(false)
    const [exportProgress, setExportProgress] = useState<{ current: number; total: number; status: string } | null>(null)
    const [exportResult, setExportResult] = useState<{ success: boolean; filePath?: string; postCount?: number; mediaCount?: number; error?: string } | null>(null)
    const [refreshSpin, setRefreshSpin] = useState(false)
    const [calendarPicker, setCalendarPicker] = useState<{ field: 'start' | 'end'; month: Date } | null>(null)
    const [showYearMonthPicker, setShowYearMonthPicker] = useState(false)

    // 触发器相关状态
    const [showTriggerDialog, setShowTriggerDialog] = useState(false)
    const [triggerInstalled, setTriggerInstalled] = useState<boolean | null>(null)
    const [triggerLoading, setTriggerLoading] = useState(false)
    const [triggerMessage, setTriggerMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

    const postsContainerRef = useRef<HTMLDivElement>(null)
    const [hasNewer, setHasNewer] = useState(false)
    const [loadingNewer, setLoadingNewer] = useState(false)
    const postsRef = useRef<SnsPost[]>([])
    const scrollAdjustmentRef = useRef<{ scrollHeight: number; scrollTop: number } | null>(null)

    // Sync posts ref
    useEffect(() => {
        postsRef.current = posts
    }, [posts])
    // 在 DOM 更新后、浏览器绘制前同步调整滚动位置，防止向上加载时页面跳动
    useLayoutEffect(() => {
        const snapshot = scrollAdjustmentRef.current;
        if (snapshot && postsContainerRef.current) {
            const container = postsContainerRef.current;
            const addedHeight = container.scrollHeight - snapshot.scrollHeight;
            if (addedHeight > 0) {
                container.scrollTop = snapshot.scrollTop + addedHeight;
            }
            scrollAdjustmentRef.current = null;
        }
    }, [posts])

    const formatDateOnly = (timestamp: number | null): string => {
        if (!timestamp || timestamp <= 0) return '--'
        const date = new Date(timestamp * 1000)
        if (Number.isNaN(date.getTime())) return '--'
        const year = date.getFullYear()
        const month = String(date.getMonth() + 1).padStart(2, '0')
        const day = String(date.getDate()).padStart(2, '0')
        return `${year}-${month}-${day}`
    }

    const loadOverviewStats = useCallback(async () => {
        setOverviewStatsLoading(true)
        try {
            const statsResult = await window.electronAPI.sns.getExportStats()
            if (!statsResult.success || !statsResult.data) {
                throw new Error(statsResult.error || '获取朋友圈统计失败')
            }

            const totalPosts = Math.max(0, Number(statsResult.data.totalPosts || 0))
            const totalFriends = Math.max(0, Number(statsResult.data.totalFriends || 0))
            let earliestTime: number | null = null
            let latestTime: number | null = null

            if (totalPosts > 0) {
                const [latestResult, earliestResult] = await Promise.all([
                    window.electronAPI.sns.getTimeline(1, 0),
                    window.electronAPI.sns.getTimeline(1, Math.max(totalPosts - 1, 0))
                ])
                const latestTs = Number(latestResult.timeline?.[0]?.createTime || 0)
                const earliestTs = Number(earliestResult.timeline?.[0]?.createTime || 0)

                if (latestResult.success && Number.isFinite(latestTs) && latestTs > 0) {
                    latestTime = Math.floor(latestTs)
                }
                if (earliestResult.success && Number.isFinite(earliestTs) && earliestTs > 0) {
                    earliestTime = Math.floor(earliestTs)
                }
            }

            setOverviewStats({
                totalPosts,
                totalFriends,
                earliestTime,
                latestTime
            })
        } catch (error) {
            console.error('Failed to load SNS overview stats:', error)
        } finally {
            setOverviewStatsLoading(false)
        }
    }, [])

    const loadPosts = useCallback(async (options: { reset?: boolean, direction?: 'older' | 'newer' } = {}) => {
        const { reset = false, direction = 'older' } = options
        if (loadingRef.current) return

        loadingRef.current = true
        if (direction === 'newer') setLoadingNewer(true)
        else setLoading(true)

        try {
            const limit = 20
            let startTs: number | undefined = undefined
            let endTs: number | undefined = undefined

            if (reset) {
                // If jumping to date, set endTs to end of that day
                if (jumpTargetDate) {
                    endTs = Math.floor(jumpTargetDate.getTime() / 1000) + 86399
                }
            } else if (direction === 'newer') {
                const currentPosts = postsRef.current
                if (currentPosts.length > 0) {
                    const topTs = currentPosts[0].createTime

                    const result = await window.electronAPI.sns.getTimeline(
                        limit,
                        0,
                        selectedUsernames,
                        searchKeyword,
                        topTs + 1,
                        undefined
                    );

                    if (result.success && result.timeline && result.timeline.length > 0) {
                        if (postsContainerRef.current) {
                            scrollAdjustmentRef.current = {
                                scrollHeight: postsContainerRef.current.scrollHeight,
                                scrollTop: postsContainerRef.current.scrollTop
                            };
                        }

                        const existingIds = new Set(currentPosts.map((p: SnsPost) => p.id));
                        const uniqueNewer = result.timeline.filter((p: SnsPost) => !existingIds.has(p.id));

                        if (uniqueNewer.length > 0) {
                            setPosts(prev => [...uniqueNewer, ...prev].sort((a, b) => b.createTime - a.createTime));
                        }
                        setHasNewer(result.timeline.length >= limit);
                    } else {
                        setHasNewer(false);
                    }
                }
                setLoadingNewer(false);
                loadingRef.current = false;
                return;
            } else {
                // Loading older
                const currentPosts = postsRef.current
                if (currentPosts.length > 0) {
                    endTs = currentPosts[currentPosts.length - 1].createTime - 1
                }
            }

            const result = await window.electronAPI.sns.getTimeline(
                limit,
                0,
                selectedUsernames,
                searchKeyword,
                startTs, // default undefined
                endTs
            )

            if (result.success && result.timeline) {
                if (reset) {
                    setPosts(result.timeline)
                    setHasMore(result.timeline.length >= limit)

                    // Check for newer items above topTs
                    const topTs = result.timeline[0]?.createTime || 0;
                    if (topTs > 0) {
                        const checkResult = await window.electronAPI.sns.getTimeline(1, 0, selectedUsernames, searchKeyword, topTs + 1, undefined);
                        setHasNewer(!!(checkResult.success && checkResult.timeline && checkResult.timeline.length > 0));
                    } else {
                        setHasNewer(false);
                    }

                    if (postsContainerRef.current) {
                        postsContainerRef.current.scrollTop = 0
                    }
                } else {
                    if (result.timeline.length > 0) {
                        setPosts(prev => [...prev, ...result.timeline!].sort((a, b) => b.createTime - a.createTime))
                    }
                    if (result.timeline.length < limit) {
                        setHasMore(false)
                    }
                }
            }
        } catch (error) {
            console.error('Failed to load SNS timeline:', error)
        } finally {
            setLoading(false)
            setLoadingNewer(false)
            loadingRef.current = false
        }
    }, [selectedUsernames, searchKeyword, jumpTargetDate])

    // Load Contacts（合并好友+曾经好友+朋友圈发布者，enrichSessionsContactInfo 补充头像）
    const loadContacts = useCallback(async () => {
        setContactsLoading(true)
        try {
            // 并行获取联系人列表、朋友圈发布者列表和每个发布者的动态条数
            const [contactsResult, snsResult, snsCountsResult] = await Promise.all([
                window.electronAPI.chat.getContacts(),
                window.electronAPI.sns.getSnsUsernames(),
                window.electronAPI.sns.getUserPostCounts()
            ])
            const snsPostCountMap = new Map<string, number>(
                Object.entries(snsCountsResult.success ? (snsCountsResult.data || {}) : {})
                    .map(([username, count]) => [username, Math.max(0, Number(count || 0))])
            )

            // 以联系人为基础，按 username 去重
            const contactMap = new Map<string, Contact>()

            // 好友和曾经的好友
            if (contactsResult.success && contactsResult.contacts) {
                for (const c of contactsResult.contacts) {
                    if (c.type === 'friend' || c.type === 'former_friend') {
                        contactMap.set(c.username, {
                            username: c.username,
                            displayName: c.displayName,
                            avatarUrl: c.avatarUrl,
                            type: c.type === 'former_friend' ? 'former_friend' : 'friend',
                            postCount: snsPostCountMap.get(c.username) || 0
                        })
                    }
                }
            }

            // 朋友圈发布者（补充不在联系人列表中的用户）
            if (snsResult.success && snsResult.usernames) {
                for (const u of snsResult.usernames) {
                    if (!contactMap.has(u)) {
                        contactMap.set(u, { username: u, displayName: u, type: 'sns_only', postCount: snsPostCountMap.get(u) || 0 })
                    }
                }
            }

            const allUsernames = Array.from(contactMap.keys())

            // 用 enrichSessionsContactInfo 统一补充头像和显示名
            if (allUsernames.length > 0) {
                const enriched = await window.electronAPI.chat.enrichSessionsContactInfo(allUsernames)
                if (enriched.success && enriched.contacts) {
                    for (const [username, extra] of Object.entries(enriched.contacts) as [string, { displayName?: string; avatarUrl?: string }][]) {
                        const c = contactMap.get(username)
                        if (c) {
                            c.displayName = extra.displayName || c.displayName
                            c.avatarUrl = extra.avatarUrl || c.avatarUrl
                        }
                    }
                }
            }

            setContacts(Array.from(contactMap.values()))
        } catch (error) {
            console.error('Failed to load contacts:', error)
        } finally {
            setContactsLoading(false)
        }
    }, [])

    // Initial Load & Listeners
    useEffect(() => {
        loadContacts()
        loadOverviewStats()
    }, [loadContacts, loadOverviewStats])

    useEffect(() => {
        const handleChange = () => {
            // wxid changed, reset everything
            setPosts([]); setHasMore(true); setHasNewer(false);
            setSelectedUsernames([]); setSearchKeyword(''); setJumpTargetDate(undefined);
            loadContacts();
            loadOverviewStats();
            loadPosts({ reset: true });
        }
        window.addEventListener('wxid-changed', handleChange as EventListener)
        return () => window.removeEventListener('wxid-changed', handleChange as EventListener)
    }, [loadContacts, loadOverviewStats, loadPosts])

    useEffect(() => {
        const timer = setTimeout(() => {
            loadPosts({ reset: true })
        }, 500)
        return () => clearTimeout(timer)
    }, [selectedUsernames, searchKeyword, jumpTargetDate, loadPosts])

    const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
        const { scrollTop, clientHeight, scrollHeight } = e.currentTarget
        if (scrollHeight - scrollTop - clientHeight < 400 && hasMore && !loading && !loadingNewer) {
            loadPosts({ direction: 'older' })
        }
        if (scrollTop < 10 && hasNewer && !loading && !loadingNewer) {
            loadPosts({ direction: 'newer' })
        }
    }

    const handleWheel = (e: React.WheelEvent<HTMLDivElement>) => {
        const container = postsContainerRef.current
        if (!container) return
        if (e.deltaY < -20 && container.scrollTop <= 0 && hasNewer && !loading && !loadingNewer) {
            loadPosts({ direction: 'newer' })
        }
    }

    return (
        <div className="sns-page-layout">
            <div className="sns-main-viewport">
                <div className="sns-feed-container">
                    <div className="feed-header">
                        <div className="feed-header-main">
                            <h2>朋友圈</h2>
                            <div className={`feed-stats-line ${overviewStatsLoading ? 'loading' : ''}`}>
                                共 {overviewStats.totalPosts} 条 ｜ {formatDateOnly(overviewStats.earliestTime)} ~ {formatDateOnly(overviewStats.latestTime)} ｜ {overviewStats.totalFriends} 位好友
                            </div>
                        </div>
                        <div className="header-actions">
                            <button
                                onClick={async () => {
                                    setTriggerMessage(null)
                                    setShowTriggerDialog(true)
                                    setTriggerLoading(true)
                                    try {
                                        const r = await window.electronAPI.sns.checkBlockDeleteTrigger()
                                        setTriggerInstalled(r.success ? (r.installed ?? false) : false)
                                    } catch {
                                        setTriggerInstalled(false)
                                    } finally {
                                        setTriggerLoading(false)
                                    }
                                }}
                                className="icon-btn"
                                title="朋友圈保护插件"
                            >
                                <Shield size={20} />
                            </button>
                            <button
                                onClick={() => {
                                    setExportResult(null)
                                    setExportProgress(null)
                                    setExportDateRange({ start: '', end: '' })
                                    setShowExportDialog(true)
                                }}
                                className="icon-btn export-btn"
                                title="导出朋友圈"
                            >
                                <Download size={20} />
                            </button>
                            <button
                                onClick={() => {
                                    setRefreshSpin(true)
                                    loadPosts({ reset: true })
                                    loadOverviewStats()
                                    setTimeout(() => setRefreshSpin(false), 800)
                                }}
                                disabled={loading || loadingNewer}
                                className="icon-btn refresh-btn"
                                title="从头刷新"
                            >
                                <RefreshCw size={20} className={(loading || loadingNewer || refreshSpin) ? 'spinning' : ''} />
                            </button>
                        </div>
                    </div>

                    <div className="sns-posts-scroll" onScroll={handleScroll} onWheel={handleWheel} ref={postsContainerRef}>
                        {loadingNewer && (
                            <div className="status-indicator loading-newer">
                                <RefreshCw size={16} className="spinning" />
                                <span>正在检查更新的动态...</span>
                            </div>
                        )}

                        {!loadingNewer && hasNewer && (
                            <div className="status-indicator newer-hint" onClick={() => loadPosts({ direction: 'newer' })}>
                                有新动态，点击查看
                            </div>
                        )}

                        <div className="posts-list">
                            {posts.map(post => (
                                <SnsPostItem
                                    key={post.id}
                                    post={{ ...post, isProtected: triggerInstalled === true }}
                                    onPreview={(src, isVideo, liveVideoPath) => {
                                        if (isVideo) {
                                            void window.electronAPI.window.openVideoPlayerWindow(src)
                                        } else {
                                            void window.electronAPI.window.openImageViewerWindow(src, liveVideoPath || undefined)
                                        }
                                    }}
                                    onDebug={(p) => setDebugPost(p)}
                                    onDelete={(postId) => {
                                        setPosts(prev => prev.filter(p => p.id !== postId))
                                        loadOverviewStats()
                                    }}
                                />
                            ))}
                        </div>

                        {loading && posts.length === 0 && (
                            <div className="initial-loading">
                                <div className="loading-pulse">
                                    <div className="pulse-circle"></div>
                                    <span>正在加载朋友圈...</span>
                                </div>
                            </div>
                        )}

                        {loading && posts.length > 0 && (
                            <div className="status-indicator loading-more">
                                <RefreshCw size={16} className="spinning" />
                                <span>正在加载更多...</span>
                            </div>
                        )}

                        {!hasMore && posts.length > 0 && (
                            <div className="status-indicator no-more">{
                                selectedUsernames.length === 1 &&
                                contacts.find(c => c.username === selectedUsernames[0])?.type === 'former_friend'
                                    ? '在时间的长河里刻舟求剑'
                                    : '或许过往已无可溯洄，但好在还有可以与你相遇的明天'
                            }</div>
                        )}

                        {!loading && posts.length === 0 && (
                            <div className="no-results">
                                <div className="no-results-icon"><Search size={48} /></div>
                                <p>未找到相关动态</p>
                                {(selectedUsernames.length > 0 || searchKeyword || jumpTargetDate) && (
                                    <button onClick={() => {
                                        setSearchKeyword(''); setSelectedUsernames([]); setJumpTargetDate(undefined);
                                    }} className="reset-inline">
                                        重置筛选条件
                                    </button>
                                )}
                            </div>
                        )}
                    </div>
                </div>
            </div>

            <SnsFilterPanel
                searchKeyword={searchKeyword}
                setSearchKeyword={setSearchKeyword}
                jumpTargetDate={jumpTargetDate}
                setJumpTargetDate={setJumpTargetDate}
                onOpenJumpDialog={() => setShowJumpDialog(true)}
                selectedUsernames={selectedUsernames}
                setSelectedUsernames={setSelectedUsernames}
                contacts={contacts}
                contactSearch={contactSearch}
                setContactSearch={setContactSearch}
                loading={contactsLoading}
            />

            {/* Dialogs and Overlays */}
            <JumpToDateDialog
                isOpen={showJumpDialog}
                onClose={() => setShowJumpDialog(false)}
                onSelect={(date) => {
                    setJumpTargetDate(date)
                    setShowJumpDialog(false)
                }}
                currentDate={jumpTargetDate || new Date()}
            />

            {debugPost && (
                <div className="modal-overlay" onClick={() => setDebugPost(null)}>
                    <div className="debug-dialog" onClick={(e) => e.stopPropagation()}>
                        <div className="debug-dialog-header">
                            <h3>原始数据</h3>
                            <button className="close-btn" onClick={() => setDebugPost(null)}>
                                <X size={20} />
                            </button>
                        </div>
                        <div className="debug-dialog-body">
                            <pre className="json-code">
                                {JSON.stringify(debugPost, null, 2)}
                            </pre>
                        </div>
                    </div>
                </div>
            )}

            {/* 朋友圈防删除插件对话框 */}
            {showTriggerDialog && (
                <div className="modal-overlay" onClick={() => { setShowTriggerDialog(false); setTriggerMessage(null) }}>
                    <div className="sns-protect-dialog" onClick={(e) => e.stopPropagation()}>
                        <button className="close-btn sns-protect-close" onClick={() => { setShowTriggerDialog(false); setTriggerMessage(null) }}>
                            <X size={18} />
                        </button>

                        {/* 顶部图标区 */}
                        <div className="sns-protect-hero">
                            <div className={`sns-protect-icon-wrap ${triggerInstalled ? 'active' : ''}`}>
                                {triggerLoading
                                    ? <RefreshCw size={28} className="spinning" />
                                    : triggerInstalled
                                        ? <Shield size={28} />
                                        : <ShieldOff size={28} />
                                }
                            </div>
                            <div className="sns-protect-title">朋友圈防删除</div>
                            <div className={`sns-protect-status-badge ${triggerInstalled ? 'on' : 'off'}`}>
                                {triggerLoading ? '检查中…' : triggerInstalled ? '已启用' : '未启用'}
                            </div>
                        </div>

                        {/* 说明 */}
                        <div className="sns-protect-desc">
                            启用后，WeFlow将拦截朋友圈删除操作<br/>已同步的动态不会从本地数据库中消失<br/>新的动态仍可正常同步。
                        </div>

                        {/* 操作反馈 */}
                        {triggerMessage && (
                            <div className={`sns-protect-feedback ${triggerMessage.type}`}>
                                {triggerMessage.type === 'success' ? <CheckCircle size={14} /> : <AlertCircle size={14} />}
                                <span>{triggerMessage.text}</span>
                            </div>
                        )}

                        {/* 操作按钮 */}
                        <div className="sns-protect-actions">
                            {!triggerInstalled ? (
                                <button
                                    className="sns-protect-btn primary"
                                    disabled={triggerLoading}
                                    onClick={async () => {
                                        setTriggerLoading(true)
                                        setTriggerMessage(null)
                                        try {
                                            const r = await window.electronAPI.sns.installBlockDeleteTrigger()
                                            if (r.success) {
                                                setTriggerInstalled(true)
                                                setTriggerMessage({ type: 'success', text: r.alreadyInstalled ? '插件已存在，无需重复安装' : '已启用朋友圈防删除保护' })
                                            } else {
                                                setTriggerMessage({ type: 'error', text: r.error || '安装失败' })
                                            }
                                        } catch (e: any) {
                                            setTriggerMessage({ type: 'error', text: e.message || String(e) })
                                        } finally {
                                            setTriggerLoading(false)
                                        }
                                    }}
                                >
                                    <Shield size={15} />
                                    启用保护
                                </button>
                            ) : (
                                <button
                                    className="sns-protect-btn danger"
                                    disabled={triggerLoading}
                                    onClick={async () => {
                                        setTriggerLoading(true)
                                        setTriggerMessage(null)
                                        try {
                                            const r = await window.electronAPI.sns.uninstallBlockDeleteTrigger()
                                            if (r.success) {
                                                setTriggerInstalled(false)
                                                setTriggerMessage({ type: 'success', text: '已关闭朋友圈防删除保护' })
                                            } else {
                                                setTriggerMessage({ type: 'error', text: r.error || '卸载失败' })
                                            }
                                        } catch (e: any) {
                                            setTriggerMessage({ type: 'error', text: e.message || String(e) })
                                        } finally {
                                            setTriggerLoading(false)
                                        }
                                    }}
                                >
                                    <ShieldOff size={15} />
                                    关闭保护
                                </button>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {/* 导出对话框 */}
            {showExportDialog && (
                <div className="modal-overlay" onClick={() => !isExporting && setShowExportDialog(false)}>
                    <div className="export-dialog" onClick={(e) => e.stopPropagation()}>
                        <div className="export-dialog-header">
                            <h3>导出朋友圈</h3>
                            <button className="close-btn" onClick={() => !isExporting && setShowExportDialog(false)} disabled={isExporting}>
                                <X size={20} />
                            </button>
                        </div>

                        <div className="export-dialog-body">
                            {/* 筛选条件提示 */}
                            {(selectedUsernames.length > 0 || searchKeyword) && (
                                <div className="export-filter-info">
                                    <span className="filter-badge">筛选导出</span>
                                    {searchKeyword && <span className="filter-tag">关键词: "{searchKeyword}"</span>}
                                    {selectedUsernames.length > 0 && (
                                        <span className="filter-tag">
                                            <Users size={12} />
                                            {selectedUsernames.length} 个联系人
                                            <span className="sync-hint">（同步自侧栏筛选）</span>
                                        </span>
                                    )}
                                </div>
                            )}

                            {!exportResult ? (
                                <>
                                    {/* 格式选择 */}
                                    <div className="export-section">
                                        <label className="export-label">导出格式</label>
                                        <div className="export-format-options">
                                            <button
                                                className={`format-option ${exportFormat === 'html' ? 'active' : ''}`}
                                                onClick={() => setExportFormat('html')}
                                                disabled={isExporting}
                                            >
                                                <FileText size={20} />
                                                <span>HTML</span>
                                                <small>浏览器可直接查看</small>
                                            </button>
                                            <button
                                                className={`format-option ${exportFormat === 'json' ? 'active' : ''}`}
                                                onClick={() => setExportFormat('json')}
                                                disabled={isExporting}
                                            >
                                                <FileJson size={20} />
                                                <span>JSON</span>
                                                <small>结构化数据</small>
                                            </button>
                                        </div>
                                    </div>

                                    {/* 输出路径 */}
                                    <div className="export-section">
                                        <label className="export-label">输出目录</label>
                                        <div className="export-path-row">
                                            <input
                                                type="text"
                                                value={exportFolder}
                                                readOnly
                                                placeholder="点击选择输出目录..."
                                                className="export-path-input"
                                            />
                                            <button
                                                className="export-browse-btn"
                                                onClick={async () => {
                                                    const result = await window.electronAPI.sns.selectExportDir()
                                                    if (!result.canceled && result.filePath) {
                                                        setExportFolder(result.filePath)
                                                    }
                                                }}
                                                disabled={isExporting}
                                            >
                                                <FolderOpen size={16} />
                                            </button>
                                        </div>
                                    </div>

                                    {/* 时间范围 */}
                                    <div className="export-section">
                                        <label className="export-label"><Calendar size={14} /> 时间范围（可选）</label>
                                        <div className="export-date-row">
                                            <div className="date-picker-trigger" onClick={() => {
                                                if (!isExporting) setCalendarPicker(prev => prev?.field === 'start' ? null : { field: 'start', month: exportDateRange.start ? new Date(exportDateRange.start) : new Date() })
                                            }}>
                                                <Calendar size={14} />
                                                <span className={exportDateRange.start ? '' : 'placeholder'}>
                                                    {exportDateRange.start || '开始日期'}
                                                </span>
                                                {exportDateRange.start && (
                                                    <X size={12} className="clear-date" onClick={(e) => { e.stopPropagation(); setExportDateRange(prev => ({ ...prev, start: '' })) }} />
                                                )}
                                            </div>
                                            <span className="date-separator">至</span>
                                            <div className="date-picker-trigger" onClick={() => {
                                                if (!isExporting) setCalendarPicker(prev => prev?.field === 'end' ? null : { field: 'end', month: exportDateRange.end ? new Date(exportDateRange.end) : new Date() })
                                            }}>
                                                <Calendar size={14} />
                                                <span className={exportDateRange.end ? '' : 'placeholder'}>
                                                    {exportDateRange.end || '结束日期'}
                                                </span>
                                                {exportDateRange.end && (
                                                    <X size={12} className="clear-date" onClick={(e) => { e.stopPropagation(); setExportDateRange(prev => ({ ...prev, end: '' })) }} />
                                                )}
                                            </div>
                                        </div>
                                    </div>

                                    {/* 媒体导出 */}
                                    <div className="export-section">
                                        <div className="export-toggle-row">
                                            <div className="toggle-label">
                                                <Image size={16} />
                                                <span>导出媒体文件（图片/视频）</span>
                                            </div>
                                            <button
                                                className={`toggle-switch${exportMedia ? ' active' : ''}`}
                                                onClick={() => !isExporting && setExportMedia(!exportMedia)}
                                                disabled={isExporting}
                                            >
                                                <span className="toggle-knob" />
                                            </button>
                                        </div>
                                        {exportMedia && (
                                            <p className="export-media-hint">媒体文件将保存到输出目录的 media 子目录中，可能需要较长时间</p>
                                        )}
                                    </div>

                                    {/* 同步提示 */}
                                    <div className="export-sync-hint">
                                        <Info size={14} />
                                        <span>将同步主页面的联系人范围筛选及关键词搜索</span>
                                    </div>

                                    {/* 进度条 */}
                                    {isExporting && exportProgress && (
                                        <div className="export-progress">
                                            <div className="export-progress-bar">
                                                <div
                                                    className="export-progress-fill"
                                                    style={{ width: exportProgress.total > 0 ? `${Math.round((exportProgress.current / exportProgress.total) * 100)}%` : '100%' }}
                                                />
                                            </div>
                                            <span className="export-progress-text">{exportProgress.status}</span>
                                        </div>
                                    )}

                                    {/* 操作按钮 */}
                                    <div className="export-actions">
                                        <button
                                            className="export-cancel-btn"
                                            onClick={() => setShowExportDialog(false)}
                                            disabled={isExporting}
                                        >
                                            取消
                                        </button>
                                        <button
                                            className="export-start-btn"
                                            disabled={!exportFolder || isExporting}
                                            onClick={async () => {
                                                setIsExporting(true)
                                                setExportProgress({ current: 0, total: 0, status: '准备导出...' })
                                                setExportResult(null)

                                                // 监听进度
                                                const removeProgress = window.electronAPI.sns.onExportProgress((progress: any) => {
                                                    setExportProgress(progress)
                                                })

                                                try {
                                                    const result = await window.electronAPI.sns.exportTimeline({
                                                        outputDir: exportFolder,
                                                        format: exportFormat,
                                                        usernames: selectedUsernames.length > 0 ? selectedUsernames : undefined,
                                                        keyword: searchKeyword || undefined,
                                                        exportMedia,
                                                        startTime: exportDateRange.start ? Math.floor(new Date(exportDateRange.start).getTime() / 1000) : undefined,
                                                        endTime: exportDateRange.end ? Math.floor(new Date(exportDateRange.end + 'T23:59:59').getTime() / 1000) : undefined
                                                    })
                                                    setExportResult(result)
                                                } catch (e: any) {
                                                    setExportResult({ success: false, error: e.message || String(e) })
                                                } finally {
                                                    setIsExporting(false)
                                                    removeProgress()
                                                }
                                            }}
                                        >
                                            {isExporting ? '导出中...' : '开始导出'}
                                        </button>
                                    </div>
                                </>
                            ) : (
                                /* 导出结果 */
                                <div className="export-result">
                                    {exportResult.success ? (
                                        <>
                                            <div className="export-result-icon success">
                                                <CheckCircle size={48} />
                                            </div>
                                            <h4>导出成功</h4>
                                            <p>共导出 {exportResult.postCount} 条动态{exportResult.mediaCount ? `，${exportResult.mediaCount} 个媒体文件` : ''}</p>
                                            <div className="export-result-actions">
                                                <button
                                                    className="export-open-btn"
                                                    onClick={() => {
                                                        if (exportFolder) {
                                                            window.electronAPI.shell.openExternal(`file://${exportFolder}`)
                                                        }
                                                    }}
                                                >
                                                    <FolderOpen size={16} />
                                                    打开目录
                                                </button>
                                                <button
                                                    className="export-done-btn"
                                                    onClick={() => setShowExportDialog(false)}
                                                >
                                                    完成
                                                </button>
                                            </div>
                                        </>
                                    ) : (
                                        <>
                                            <div className="export-result-icon error">
                                                <AlertCircle size={48} />
                                            </div>
                                            <h4>导出失败</h4>
                                            <p className="error-text">{exportResult.error}</p>
                                            <button
                                                className="export-done-btn"
                                                onClick={() => setExportResult(null)}
                                            >
                                                重试
                                            </button>
                                        </>
                                    )}
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {/* 日期选择弹窗 */}
            {calendarPicker && (
                <div className="calendar-overlay" onClick={() => { setCalendarPicker(null); setShowYearMonthPicker(false) }}>
                    <div className="calendar-modal" onClick={e => e.stopPropagation()}>
                        <div className="calendar-header">
                            <div className="title-area">
                                <Calendar size={18} />
                                <h3>选择{calendarPicker.field === 'start' ? '开始' : '结束'}日期</h3>
                            </div>
                            <button className="close-btn" onClick={() => { setCalendarPicker(null); setShowYearMonthPicker(false) }}>
                                <X size={18} />
                            </button>
                        </div>
                        <div className="calendar-view">
                            <div className="calendar-nav">
                                <button className="nav-btn" onClick={() => setCalendarPicker(prev => prev ? { ...prev, month: new Date(prev.month.getFullYear(), prev.month.getMonth() - 1, 1) } : null)}>
                                    <ChevronLeft size={18} />
                                </button>
                                <span className="current-month clickable" onClick={() => setShowYearMonthPicker(!showYearMonthPicker)}>
                                    {calendarPicker.month.getFullYear()}年{calendarPicker.month.getMonth() + 1}月
                                </span>
                                <button className="nav-btn" onClick={() => setCalendarPicker(prev => prev ? { ...prev, month: new Date(prev.month.getFullYear(), prev.month.getMonth() + 1, 1) } : null)}>
                                    <ChevronRight size={18} />
                                </button>
                            </div>
                            {showYearMonthPicker ? (
                                <div className="year-month-picker">
                                    <div className="year-selector">
                                        <button className="nav-btn" onClick={() => setCalendarPicker(prev => prev ? { ...prev, month: new Date(prev.month.getFullYear() - 1, prev.month.getMonth(), 1) } : null)}>
                                            <ChevronLeft size={16} />
                                        </button>
                                        <span className="year-label">{calendarPicker.month.getFullYear()}年</span>
                                        <button className="nav-btn" onClick={() => setCalendarPicker(prev => prev ? { ...prev, month: new Date(prev.month.getFullYear() + 1, prev.month.getMonth(), 1) } : null)}>
                                            <ChevronRight size={16} />
                                        </button>
                                    </div>
                                    <div className="month-grid">
                                        {['一月','二月','三月','四月','五月','六月','七月','八月','九月','十月','十一月','十二月'].map((name, i) => (
                                            <button
                                                key={i}
                                                className={`month-btn ${i === calendarPicker.month.getMonth() ? 'active' : ''}`}
                                                onClick={() => {
                                                    setCalendarPicker(prev => prev ? { ...prev, month: new Date(prev.month.getFullYear(), i, 1) } : null)
                                                    setShowYearMonthPicker(false)
                                                }}
                                            >{name}</button>
                                        ))}
                                    </div>
                                </div>
                            ) : (
                              <>
                            <div className="calendar-weekdays">
                                {['日', '一', '二', '三', '四', '五', '六'].map(d => <div key={d} className="weekday">{d}</div>)}
                            </div>
                            <div className="calendar-days">
                                {(() => {
                                    const y = calendarPicker.month.getFullYear()
                                    const m = calendarPicker.month.getMonth()
                                    const firstDay = new Date(y, m, 1).getDay()
                                    const daysInMonth = new Date(y, m + 1, 0).getDate()
                                    const cells: (number | null)[] = []
                                    for (let i = 0; i < firstDay; i++) cells.push(null)
                                    for (let i = 1; i <= daysInMonth; i++) cells.push(i)
                                    const today = new Date()
                                    return cells.map((day, i) => {
                                        if (day === null) return <div key={i} className="day-cell empty" />
                                        const dateStr = `${y}-${String(m + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
                                        const isToday = day === today.getDate() && m === today.getMonth() && y === today.getFullYear()
                                        const currentVal = calendarPicker.field === 'start' ? exportDateRange.start : exportDateRange.end
                                        const isSelected = dateStr === currentVal
                                        return (
                                            <div
                                                key={i}
                                                className={`day-cell${isSelected ? ' selected' : ''}${isToday ? ' today' : ''}`}
                                                onClick={() => {
                                                    setExportDateRange(prev => ({ ...prev, [calendarPicker.field]: dateStr }))
                                                    setCalendarPicker(null)
                                                }}
                                            >{day}</div>
                                        )
                                    })
                                })()}
                            </div>
                              </>
                            )}
                        </div>
                        <div className="quick-options">
                            <button onClick={() => {
                                if (calendarPicker.field === 'start') {
                                    const d = new Date(); d.setMonth(d.getMonth() - 1)
                                    setExportDateRange(prev => ({ ...prev, start: d.toISOString().split('T')[0] }))
                                } else {
                                    setExportDateRange(prev => ({ ...prev, end: new Date().toISOString().split('T')[0] }))
                                }
                                setCalendarPicker(null)
                            }}>{calendarPicker.field === 'start' ? '一个月前' : '今天'}</button>
                            <button onClick={() => {
                                if (calendarPicker.field === 'start') {
                                    const d = new Date(); d.setMonth(d.getMonth() - 3)
                                    setExportDateRange(prev => ({ ...prev, start: d.toISOString().split('T')[0] }))
                                } else {
                                    const d = new Date(); d.setMonth(d.getMonth() - 1)
                                    setExportDateRange(prev => ({ ...prev, end: d.toISOString().split('T')[0] }))
                                }
                                setCalendarPicker(null)
                            }}>{calendarPicker.field === 'start' ? '三个月前' : '一个月前'}</button>
                        </div>
                        <div className="dialog-footer">
                            <button className="cancel-btn" onClick={() => { setCalendarPicker(null); setShowYearMonthPicker(false) }}>取消</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    )
}
