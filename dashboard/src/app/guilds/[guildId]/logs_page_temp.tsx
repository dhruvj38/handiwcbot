'use client';

import { useParams } from 'next/navigation';
import { useState, useEffect, useRef } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { useWebSocket } from '@/hooks/useWebSocket';

interface LogEntry {
    id: string;
    type: string;
    severity: 'debug' | 'info' | 'warn' | 'error';
    summary: string;
    createdAt: string;
    model?: string;
    promptTokens?: number;
    outputTokens?: number;
    latencyMs?: number;
    costUsd?: number;
    metadata?: any;
}

export default function LogsPage() {
    const { guildId } = useParams();
    const { token } = useAuth();
    const [logs, setLogs] = useState<LogEntry[]>([]);
    const [filterType, setFilterType] = useState<string>('all');
    const [isLoading, setIsLoading] = useState(true);
    const scrollRef = useRef<HTMLDivElement>(null);

    // WebSocket for real-time updates
    useWebSocket({
        onMessage: (event) => {
            if (event.type === 'log:created') {
                fetchLogs();
            }
        },
    });

    const fetchLogs = async () => {
        try {
            const query = new URLSearchParams();
            if (filterType !== 'all') {
                // Map "ai_activity" to "ai_response" for now, or handle multiple types if backend supports it
                // The backend currently filters by exact type match.
                // If we want to show all AI stuff, we might need to adjust backend or just pick the main one.
                // Since we only log 'ai_response', we'll use that.
                const typeToSend = filterType === 'ai_activity' ? 'ai_response' : filterType;
                query.append('type', typeToSend);
            }

            const res = await fetch(`http://localhost:3001/api/guilds/${guildId}/logs?${query.toString()}`, {
                headers: { Authorization: `Bearer ${token}` },
            });
            const data = await res.json();
            setLogs(data.logs);
        } catch (error) {
            console.error('Failed to fetch logs:', error);
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        fetchLogs();
        const interval = setInterval(fetchLogs, 5000);
        return () => clearInterval(interval);
    }, [guildId, token, filterType]);

    const getSeverityColor = (severity: string) => {
        switch (severity) {
            case 'error': return 'text-red-400 bg-red-400/10 border-red-400/20';
            case 'warn': return 'text-yellow-400 bg-yellow-400/10 border-yellow-400/20';
            case 'debug': return 'text-gray-400 bg-gray-400/10 border-gray-400/20';
            default: return 'text-blue-400 bg-blue-400/10 border-blue-400/20';
        }
    };

    const getTypeIcon = (type: string) => {
        if (type.includes('ai')) return '🤖';
        if (type.includes('voice')) return '🎤';
        if (type.includes('message')) return '💬';
        if (type.includes('error')) return '⚠️';
        return '📝';
    };

    return (
        <div className="h-full flex flex-col bg-[#0f111a] text-white p-6">
            <div className="flex justify-between items-center mb-6">
                <div>
                    <h1 className="text-2xl font-bold bg-gradient-to-r from-blue-400 to-purple-400 bg-clip-text text-transparent">
                        Activity Logs
                    </h1>
                    <p className="text-gray-400 text-sm mt-1">Real-time server activity and AI interactions</p>
                </div>

                <div className="flex gap-2">
                    <select
                        value={filterType}
                        onChange={(e) => setFilterType(e.target.value)}
                        className="bg-[#1a1d2d] border border-gray-800 rounded-lg px-4 py-2 text-sm focus:outline-none focus:border-blue-500 transition-colors"
                    >
                        <option value="all">All Activities</option>
                        <option value="ai_activity">AI Activity</option>
                        <option value="voice_join">Voice Joins</option>
                        <option value="voice_leave">Voice Leaves</option>
                        <option value="command">Commands</option>
                        <option value="error">Errors</option>
                    </select>
                    <button
                        onClick={() => fetchLogs()}
                        className="p-2 bg-[#1a1d2d] border border-gray-800 rounded-lg hover:bg-[#2a2d3d] transition-colors"
                        title="Refresh Logs"
                    >
                        🔄
                    </button>
                </div>
            </div>

            <div className="flex-1 overflow-hidden rounded-xl border border-gray-800 bg-[#131620] shadow-xl">
                <div className="h-full overflow-y-auto p-4 space-y-2" ref={scrollRef}>
                    {isLoading && logs.length === 0 ? (
                        <div className="flex justify-center items-center h-full text-gray-500">
                            Loading logs...
                        </div>
                    ) : logs.length === 0 ? (
                        <div className="flex justify-center items-center h-full text-gray-500">
                            No logs found for this filter.
                        </div>
                    ) : (
                        logs.map((log) => (
                            <div
                                key={log.id}
                                className="group flex flex-col gap-2 p-3 rounded-lg bg-[#1a1d2d]/50 hover:bg-[#1a1d2d] border border-transparent hover:border-gray-700 transition-all duration-200"
                            >
                                <div className="flex items-start justify-between gap-4">
                                    <div className="flex items-center gap-3">
                                        <span className="text-xl" role="img" aria-label={log.type}>
                                            {getTypeIcon(log.type)}
                                        </span>
                                        <div>
                                            <div className="flex items-center gap-2">
                                                <span className={`text-xs px-2 py-0.5 rounded-full border ${getSeverityColor(log.severity)} uppercase tracking-wider font-medium`}>
                                                    {log.severity}
                                                </span>
                                                <span className="text-xs text-gray-500 font-mono">
                                                    {new Date(log.createdAt).toLocaleTimeString()}
                                                </span>
                                                <span className="text-xs text-gray-500 font-mono border border-gray-800 px-1.5 rounded">
                                                    {log.type}
                                                </span>
                                            </div>
                                            <p className="text-gray-200 mt-1 font-medium">{log.summary}</p>
                                        </div>
                                    </div>
                                </div>

                                {(log.model || log.promptTokens || log.outputTokens) && (
                                    <div className="ml-10 mt-1 p-2 rounded bg-black/20 border border-white/5 text-xs font-mono text-gray-400 grid grid-cols-2 sm:grid-cols-4 gap-2">
                                        {log.model && (
                                            <div className="flex flex-col">
                                                <span className="text-gray-600 uppercase text-[10px]">Model</span>
                                                <span className="text-blue-300">{log.model}</span>
                                            </div>
                                        )}
                                        {log.promptTokens !== undefined && (
                                            <div className="flex flex-col">
                                                <span className="text-gray-600 uppercase text-[10px]">Input</span>
                                                <span>{log.promptTokens} toks</span>
                                            </div>
                                        )}
                                        {log.outputTokens !== undefined && (
                                            <div className="flex flex-col">
                                                <span className="text-gray-600 uppercase text-[10px]">Output</span>
                                                <span>{log.outputTokens} toks</span>
                                            </div>
                                        )}
                                        {log.latencyMs !== undefined && log.latencyMs > 0 && (
                                            <div className="flex flex-col">
                                                <span className="text-gray-600 uppercase text-[10px]">Latency</span>
                                                <span>{log.latencyMs}ms</span>
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>
                        ))
                    )}
                </div>
            </div>
        </div>
    );
}
