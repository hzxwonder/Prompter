import type { ReactNode } from 'react';
import type { PrompterSettings, PrompterView } from '../../../src/shared/models';
import { getLocaleText } from '../i18n';

const ITEMS: { view: PrompterView; icon: ReactNode }[] = [
  {
    view: 'workspace',
    icon: (
      <svg width="18" height="18" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
        {/* Kanban / columns icon */}
        <path d="M1 2a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H2a1 1 0 0 1-1-1V2zm1 0v12h2V2H2zm4 0a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V2zm1 0v7h2V2H7zm4 0a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v4a1 1 0 0 1-1 1h-2a1 1 0 0 1-1-1V2zm1 0v4h2V2h-2z"/>
      </svg>
    )
  },
  {
    view: 'history',
    icon: (
      <svg width="18" height="18" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
        {/* Clock icon */}
        <path d="M8 3.5a.5.5 0 0 0-1 0V9a.5.5 0 0 0 .252.434l3.5 2a.5.5 0 0 0 .496-.868L8 8.71V3.5z"/>
        <path d="M8 16A8 8 0 1 0 8 0a8 8 0 0 0 0 16zm7-8A7 7 0 1 1 1 8a7 7 0 0 1 14 0z"/>
      </svg>
    )
  },
  {
    view: 'shortcuts',
    icon: (
      <svg width="18" height="18" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
        {/* Keyboard icon */}
        <path d="M2 3a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V4a1 1 0 0 0-1-1H2zm0 1h12v8H2V4zm1 1v1h1V5H3zm2 0v1h1V5H5zm2 0v1h1V5H7zm2 0v1h1V5H9zm2 0v1h1V5h-1zm2 0v1h1V5h-1zM3 7v1h1V7H3zm2 0v1h1V7H5zm2 0v1h1V7H7zm2 0v1h1V7H9zm2 0v1h1V7h-1zm2 0v1h1V7h-1zM4 9.5a.5.5 0 0 1 .5-.5h7a.5.5 0 0 1 0 1h-7a.5.5 0 0 1-.5-.5z"/>
      </svg>
    )
  },
  {
    view: 'settings',
    icon: (
      <svg width="18" height="18" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
        {/* Gear icon */}
        <path d="M8 4.754a3.246 3.246 0 1 0 0 6.492 3.246 3.246 0 0 0 0-6.492zM5.754 8a2.246 2.246 0 1 1 4.492 0 2.246 2.246 0 0 1-4.492 0z"/>
        <path d="M9.796 1.343c-.527-1.79-3.065-1.79-3.592 0l-.094.319a.873.873 0 0 1-1.255.52l-.292-.16c-1.64-.892-3.433.902-2.54 2.541l.159.292a.873.873 0 0 1-.52 1.255l-.319.094c-1.79.527-1.79 3.065 0 3.592l.319.094a.873.873 0 0 1 .52 1.255l-.16.292c-.892 1.64.901 3.434 2.541 2.54l.292-.159a.873.873 0 0 1 1.255.52l.094.319c.527 1.79 3.065 1.79 3.592 0l.094-.319a.873.873 0 0 1 1.255-.52l.292.16c1.64.892 3.433-.902 2.54-2.541l-.159-.292a.873.873 0 0 1 .52-1.255l.319-.094c1.79-.527 1.79-3.065 0-3.592l-.319-.094a.873.873 0 0 1-.52-1.255l.16-.292c.892-1.64-.901-3.433-2.541-2.54l-.292.159a.873.873 0 0 1-1.255-.52l-.094-.319zm-2.633.283c.246-.835 1.428-.835 1.674 0l.094.319a1.873 1.873 0 0 0 2.693 1.115l.291-.16c.764-.415 1.6.42 1.184 1.185l-.159.292a1.873 1.873 0 0 0 1.116 2.692l.318.094c.835.246.835 1.428 0 1.674l-.319.094a1.873 1.873 0 0 0-1.115 2.693l.16.291c.415.764-.42 1.6-1.185 1.184l-.291-.159a1.873 1.873 0 0 0-2.693 1.116l-.094.318c-.246.835-1.428.835-1.674 0l-.094-.319a1.873 1.873 0 0 0-2.692-1.115l-.292.16c-.764.415-1.6-.42-1.184-1.185l.159-.291A1.873 1.873 0 0 0 1.945 8.93l-.319-.094c-.835-.246-.835-1.428 0-1.674l.319-.094A1.873 1.873 0 0 0 3.06 4.474l-.16-.292c-.415-.764.42-1.6 1.185-1.184l.292.159a1.873 1.873 0 0 0 2.692-1.115l.094-.319z"/>
      </svg>
    )
  }
];

export function SidebarNav({
  activeView,
  language,
  onChange
}: {
  activeView: PrompterView;
  language: PrompterSettings['language'];
  onChange: (view: PrompterView) => void;
}) {
  const localeText = getLocaleText(language);

  return (
    <aside className="sidebar" aria-label={localeText.sidebarAriaLabel}>
      {ITEMS.map(({ view, icon }) => {
        const label = localeText.sidebarLabels[view];

        return (
        <button
          key={view}
          type="button"
          aria-pressed={activeView === view}
          title={label}
          onClick={() => onChange(view)}
        >
          {icon}
          <span className="sidebar-label">{label}</span>
        </button>
        );
      })}
    </aside>
  );
}
