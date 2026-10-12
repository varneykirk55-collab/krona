import { useState } from 'react';
import {
  Brain,
  Plus,
  Lock,
  ArrowUpRight,
  Download,
  SlidersHorizontal,
  AlertTriangle,
  Bookmark,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import type { Memory } from '../../shared/schemas';
import { useApp } from '../context';
import { exportData } from '../api';
import { useResource } from '../hooks/useResource';
import {
  AddButton,
  Badge,
  Button,
  dateLabel,
  Empty,
  ErrorState,
  Loading,
  PageHeading,
  SearchField,
  statusLabel,
} from '../components/common';
export default function MemoryPage() {
  const { openMemory, settings, notify, navigate } = useApp(),
    [query, setQuery] = useState(''),
    [category, setCategory] = useState(''),
    [page, setPage] = useState(0),
    r = useResource<Memory[]>(
      `/memories?limit=50&offset=${page * 50}${query ? '&q=' + encodeURIComponent(query) : ''}${category ? '&category=' + category : ''}`,
    ),
    memories = r.data || [];
  return (
    <>
      <PageHeading
        eyebrow="CONTINUITY THAT BELONGS TO YOU"
        title="Memory"
        description="What matters, remembered. What changes, corrected. What you don't want, deleted."
        action={<AddButton onClick={() => openMemory()}>Add memory</AddButton>}
      />
      <div className="memory-intro">
        <span>
          <Brain size={21} />
        </span>
        <div>
          <strong>You don't need to keep explaining yourself.</strong>
          <p>
            Preferences and context carry forward with clear confidence labels. You're in charge of
            what stays.
          </p>
        </div>
        <Button variant="ghost" onClick={() => navigate('settings')}>
          <SlidersHorizontal size={15} />
          Privacy controls
        </Button>
      </div>
      <div className="standalone-toolbar">
        <div className="tabs">
          {[
            ['', 'All memories'],
            ['preferences', 'Preferences'],
            ['knowledge', 'Knowledge'],
            ['projects', 'Projects'],
            ['routines', 'Routines'],
          ].map(([v, l]) => (
            <button
              key={v}
              className={category === v ? 'selected' : ''}
              onClick={() => {
                setCategory(v);
                setPage(0);
              }}
            >
              {l}
            </button>
          ))}
        </div>
        <div className="toolbar-actions">
          <SearchField
            value={query}
            onChange={(v) => {
              setQuery(v);
              setPage(0);
            }}
            placeholder="Search your memory"
          />
          <Button
            variant="secondary"
            onClick={() => void exportData().catch((e) => notify(e.message, true))}
          >
            <Download size={15} />
            Export
          </Button>
        </div>
      </div>
      {r.error ? (
        <ErrorState message={r.error} retry={r.reload} />
      ) : r.loading && !r.data ? (
        <Loading />
      ) : memories.length ? (
        <div className="memory-grid">
          {memories.map((m) => (
            <button
              className={`card memory-card ${m.confidence === 'conflicted' ? 'conflict' : ''}`}
              key={m.id}
              onClick={() => openMemory(m)}
            >
              <div className="memory-card-top">
                <Badge tone="sage">{statusLabel(m.category)}</Badge>
                {m.sensitive && <Lock size={14} aria-label="Sensitive memory" />}
                <ArrowUpRight size={16} />
              </div>
              {m.confidence === 'conflicted' && (
                <div className="memory-conflict">
                  <AlertTriangle size={14} />
                  Conflicting information · review needed
                </div>
              )}
              <p className="memory-content">{m.content}</p>
              {m.subject && <span className="memory-subject">{m.subject}</span>}
              <div className="memory-card-bottom">
                <Badge
                  tone={
                    m.confidence === 'confirmed'
                      ? 'green'
                      : m.confidence === 'unverified' || m.confidence === 'conflicted'
                        ? 'amber'
                        : 'neutral'
                  }
                >
                  {statusLabel(m.confidence)}
                </Badge>
                <time>{dateLabel(m.updated_at, settings.timezone)}</time>
              </div>
              {settings.disabled_memory_categories.includes(m.category) && (
                <span className="retrieval-off">Retrieval disabled for this category</span>
              )}
            </button>
          ))}
        </div>
      ) : (
        <section className="card">
          <Empty
            icon={Bookmark}
            title={query ? 'No memories match that search' : 'Remember the useful things'}
            description="A communication preference, an important decision, an ongoing idea. Save the context you want to carry forward."
            action={
              <Button variant="secondary" onClick={() => openMemory()}>
                <Plus size={16} />
                Save your first memory
              </Button>
            }
          />
        </section>
      )}
      <div className="collection-footer">
        <span>{memories.length} memories in this view</span>
        <div>
          <Button variant="ghost" disabled={!page} onClick={() => setPage((p) => p - 1)}>
            <ChevronLeft size={15} />
            Previous
          </Button>
          <Button
            variant="ghost"
            disabled={(r.data?.length || 0) < 50}
            onClick={() => setPage((p) => p + 1)}
          >
            Next
            <ChevronRight size={15} />
          </Button>
        </div>
      </div>
      <div className="below-note">
        <Lock size={14} />
        No private memories are available to unverified callers. Sensitive information requires a
        signed-in session or phone PIN.
      </div>
    </>
  );
}
