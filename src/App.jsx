import { useState, useRef, useEffect } from 'react'
import OpenAI from 'openai'
import Markdown from 'react-markdown'
import './App.css'

const DEFAULT_HOST = 'http://192.168.0.51:9080'
const DEFAULT_MODEL = 'openai/gpt-oss-20b'
const DEFAULT_SYSTEM_PROMPT = 'You are a helpful assistant.'
const PROXY_BASE = 'http://localhost:3001/v1'

function createClient(host) {
  return new OpenAI({
    baseURL: PROXY_BASE,
    apiKey: 'lm-studio',
    dangerouslyAllowBrowser: true,
    defaultHeaders: { 'x-proxy-target': host },
  })
}

function ResponseMeta({ meta }) {
  if (!meta) return null
  const { usage, temperature, top_p, id, previous_response_id, model,
          created_at, completed_at, status } = meta
  const duration = completed_at && created_at ? (completed_at - created_at).toFixed(1) + 's' : null
  const tps = usage?.output_tokens && duration
    ? (usage.output_tokens / parseFloat(duration)).toFixed(1)
    : null

  return (
    <div className="response-meta">
      <div className="meta-grid">
        <span className="meta-label">Model</span>
        <span className="meta-value">{model}</span>

        <span className="meta-label">Status</span>
        <span className="meta-value">{status}</span>

        {duration && <>
          <span className="meta-label">Duration</span>
          <span className="meta-value">{duration}</span>
        </>}

        {tps && <>
          <span className="meta-label">Tokens/s</span>
          <span className="meta-value">{tps}</span>
        </>}

        {usage && <>
          <span className="meta-label">Input tokens</span>
          <span className="meta-value">{usage.input_tokens?.toLocaleString()}</span>

          <span className="meta-label">Output tokens</span>
          <span className="meta-value">{usage.output_tokens?.toLocaleString()}</span>

          {usage.output_tokens_details?.reasoning_tokens > 0 && <>
            <span className="meta-label">Reasoning tokens</span>
            <span className="meta-value">{usage.output_tokens_details.reasoning_tokens?.toLocaleString()}</span>
          </>}

          <span className="meta-label">Total tokens</span>
          <span className="meta-value">{usage.total_tokens?.toLocaleString()}</span>
        </>}

        {temperature != null && <>
          <span className="meta-label">Temperature</span>
          <span className="meta-value">{temperature}</span>
        </>}

        {top_p != null && <>
          <span className="meta-label">Top P</span>
          <span className="meta-value">{top_p}</span>
        </>}

        <span className="meta-label">Response ID</span>
        <span className="meta-value meta-id">{id}</span>

        {previous_response_id && <>
          <span className="meta-label">Previous ID</span>
          <span className="meta-value meta-id">{previous_response_id}</span>
        </>}
      </div>
    </div>
  )
}

function Message({ role, content, reasoning, streaming, meta }) {
  const [hovered, setHovered] = useState(false)
  const [mdOn, setMdOn] = useState(true)

  return (
    <div
      className={`message ${role}`}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div className="message-label">
        {role === 'user' ? 'You' : 'Assistant'}
        {role === 'assistant' && !streaming && (
          <button
            className="md-toggle"
            onClick={() => setMdOn(v => !v)}
            title="Toggle markdown"
          >
            {mdOn ? 'MD' : 'Raw'}
          </button>
        )}
      </div>
      {reasoning && (
        <details className="reasoning">
          <summary>Reasoning</summary>
          <p>{reasoning}</p>
        </details>
      )}
      <div className={`message-content ${mdOn && role === 'assistant' ? 'markdown' : ''}`}>
        {role === 'assistant' && mdOn && !streaming
          ? <Markdown>{content}</Markdown>
          : <>{content}{streaming && <span className="cursor" />}</>
        }
      </div>
      {hovered && !streaming && meta && <ResponseMeta meta={meta} />}
    </div>
  )
}

export default function App() {
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [systemPrompt, setSystemPrompt] = useState(DEFAULT_SYSTEM_PROMPT)
  const [model, setModel] = useState(DEFAULT_MODEL)
  const [host, setHost] = useState(() => localStorage.getItem('llm-host') ?? DEFAULT_HOST)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [showSettings, setShowSettings] = useState(false)

  function updateHost(value) {
    setHost(value)
    localStorage.setItem('llm-host', value)
  }
  const previousResponseId = useRef(null)
  const abortRef = useRef(null)
  const bottomRef = useRef(null)
  const inputRef = useRef(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  async function sendMessage() {
    const text = input.trim()
    if (!text || loading) return

    setMessages(prev => [...prev, { role: 'user', content: text }])
    setInput('')
    setLoading(true)
    setError(null)

    setMessages(prev => [...prev, { role: 'assistant', content: '', streaming: true }])

    const client = createClient(host)
    abortRef.current = new AbortController()

    try {
      const params = { model, input: text, stream: true }

      if (previousResponseId.current) {
        params.previous_response_id = previousResponseId.current
      } else {
        params.instructions = systemPrompt
      }

      const stream = await client.responses.create(params, {
        signal: abortRef.current.signal,
      })

      let accumulated = ''
      let reasoning = ''
      let newResponseId = null
      let completedMeta = null

      for await (const event of stream) {
        if (event.type === 'response.created' && event.response?.id) {
          newResponseId = event.response.id
        }

        if (event.type === 'response.completed') {
          newResponseId = event.response?.id ?? newResponseId
          completedMeta = event.response ?? null
        }

        if (event.type === 'response.output_text.delta') {
          accumulated += event.delta ?? ''
        }

        if (event.type === 'response.reasoning_summary_text.delta') {
          reasoning += event.delta ?? ''
        }

        setMessages(prev => {
          const updated = [...prev]
          updated[updated.length - 1] = {
            role: 'assistant', content: accumulated, reasoning, streaming: true,
          }
          return updated
        })
      }

      if (newResponseId) previousResponseId.current = newResponseId

      // Extract reasoning_text from completed output if streaming deltas didn't capture it
      if (!reasoning && completedMeta?.output) {
        const reasoningBlock = completedMeta.output.find(o => o.type === 'reasoning')
        if (reasoningBlock?.content) {
          reasoning = reasoningBlock.content
            .filter(c => c.type === 'reasoning_text')
            .map(c => c.text)
            .join('\n')
        }
      }

      setMessages(prev => {
        const updated = [...prev]
        updated[updated.length - 1] = {
          role: 'assistant', content: accumulated, reasoning, streaming: false,
          meta: completedMeta,
        }
        return updated
      })
    } catch (err) {
      if (err.name === 'AbortError') {
        setMessages(prev => {
          const updated = [...prev]
          const last = updated[updated.length - 1]
          if (last?.streaming) updated[updated.length - 1] = { ...last, streaming: false }
          return updated
        })
      } else {
        setMessages(prev => {
          const updated = [...prev]
          if (updated[updated.length - 1]?.streaming) updated.pop()
          return updated
        })
        setError(err.message)
      }
    } finally {
      setLoading(false)
      abortRef.current = null
      inputRef.current?.focus()
    }
  }

  function stopStreaming() { abortRef.current?.abort() }

  function handleKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendMessage()
    }
  }

  function clearChat() {
    abortRef.current?.abort()
    setMessages([])
    setError(null)
    previousResponseId.current = null
  }

  return (
    <div className="app">
      <header className="header">
        <div className="header-left">
          <h1>LocalLLM Chat</h1>
          <span className="endpoint">{host}/v1/responses</span>
        </div>
        <div className="header-actions">
          <button className="btn-icon" onClick={() => setShowSettings(s => !s)} title="Settings">⚙</button>
          <button className="btn-icon" onClick={clearChat} title="Clear chat">✕</button>
        </div>
      </header>

      {showSettings && (
        <div className="settings-panel">
          <label>
            Host
            <input
              value={host}
              onChange={e => updateHost(e.target.value)}
              placeholder="http://192.168.0.51:9080"
              spellCheck={false}
            />
          </label>
          <label>
            Model
            <input value={model} onChange={e => setModel(e.target.value)} placeholder="e.g. openai/gpt-oss-20b" />
          </label>
          <label>
            System Prompt
            <textarea value={systemPrompt} onChange={e => setSystemPrompt(e.target.value)} rows={3} />
          </label>
        </div>
      )}

      <div className="messages">
        {messages.length === 0 && !loading && (
          <div className="empty-state">Start a conversation with your local model.</div>
        )}
        {messages.map((msg, i) => (
          <Message
            key={i}
            role={msg.role}
            content={msg.content}
            reasoning={msg.reasoning}
            streaming={msg.streaming}
            meta={msg.meta}
          />
        ))}
        {error && <div className="error-banner"><strong>Error:</strong> {error}</div>}
        <div ref={bottomRef} />
      </div>

      <div className="input-area">
        <textarea
          ref={inputRef}
          className="input-box"
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Type a message… (Enter to send, Shift+Enter for newline)"
          rows={1}
          disabled={loading}
        />
        {loading
          ? <button className="stop-btn" onClick={stopStreaming}>Stop</button>
          : <button className="send-btn" onClick={sendMessage} disabled={!input.trim()}>Send</button>
        }
      </div>
    </div>
  )
}
