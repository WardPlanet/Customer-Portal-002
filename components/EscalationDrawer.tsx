'use client'

// ── Data ──────────────────────────────────────────────────────────────────────

type Contact = {
  initials: string
  name:     string
  role:     string
  email?:   string
  emailNote?: string
  phone?:   string
  phoneNote?: string
  hours:    string
  hoursNote?: string
}

type Tier = {
  number:   1 | 2 | 3
  label:    string
  color:    'green' | 'orange' | 'red'
  contacts: Contact[]
}

const TIERS: Tier[] = [
  {
    number: 1,
    label:  'FIRST RESPONSE',
    color:  'green',
    contacts: [
      {
        initials:  'OI',
        name:      'On-Call Implementation Coordinator',
        role:      'Conversion Support',
        email:     'implementation@planetdds.com',
        hours:     'Saturday 1–5 pm EST',
      },
      {
        initials:  'KG',
        name:      'Krista Goergen',
        role:      'Implementation Coordinator',
        email:     'kgoergen@planetdds.com',
        phone:     '949-593-0242',
        hours:     'Mon–Fri 8 am–5 pm EST',
      },
      {
        initials:   'DS',
        name:       'Denticon Support',
        role:       'General Denticon Product Questions',
        email:      'support@planetdds.com',
        emailNote:  'Or create a ticket directly in your Denticon account',
        hours:      'Mon–Fri 8 am–8 pm EST',
      },
    ],
  },
  {
    number: 2,
    label:  'ESCALATION',
    color:  'orange',
    contacts: [
      {
        initials:   'DI',
        name:       'Dedicated Image Technician',
        role:       'Installation Technician — Technical Support Only',
        phone:      '949-482-2541',
        phoneNote:  'Press 1 and leave a detailed voicemail',
        hours:      'Mon–Fri 8 am–5 pm EST',
        hoursNote:  'Saturday 9 am–3 pm EST',
      },
      {
        initials: 'RR',
        name:     'Rosalyn Rossi',
        role:     'Senior Project Manager',
        email:    'rosalyn.rossi@planetdds.com',
        phone:    '206-228-5903',
        hours:    'On-Call 24/7',
      },
      {
        initials:   'NF',
        name:       'Nicole Farris',
        role:       'Manager, Conversion Operations',
        email:      'nfarris@planetdds.com',
        phone:      '714-390-2886',
        hours:      'On-Call 24/7',
        hoursNote:  'For conversion issues only',
      },
      {
        initials: 'RP',
        name:     'Ryan Perry',
        role:     'Director of Implementation',
        email:    'ryan.perry@planetdds.com',
        phone:    '313-608-8338',
        hours:    'On-Call 24/7',
      },
    ],
  },
  {
    number: 3,
    label:  'EXECUTIVE',
    color:  'red',
    contacts: [
      {
        initials:   'IS',
        name:       'Ian Solcz',
        role:       'VP of Professional Services',
        email:      'ian.solcz@planetdds.com',
        hours:      '24/7',
        hoursNote:  'On DND 10 pm–7 am — ring twice to get through',
      },
    ],
  },
]

// ── Style maps ────────────────────────────────────────────────────────────────

const TIER_STYLES = {
  green:  { dot: 'bg-green-500',  label: 'text-green-700',  avatar: 'bg-green-500',  badge: 'bg-green-100 text-green-700 border-green-200',  card: 'border-green-200  bg-green-50/60'  },
  orange: { dot: 'bg-orange-500', label: 'text-orange-700', avatar: 'bg-orange-500', badge: 'bg-orange-100 text-orange-700 border-orange-200', card: 'border-orange-200 bg-orange-50/60' },
  red:    { dot: 'bg-red-500',    label: 'text-red-700',    avatar: 'bg-red-500',    badge: 'bg-red-100 text-red-700 border-red-200',          card: 'border-red-200   bg-red-50/60'    },
}

// ── Contact card ──────────────────────────────────────────────────────────────

function ContactCard({ contact, tier }: { contact: Contact; tier: Tier }) {
  const s = TIER_STYLES[tier.color]
  return (
    <div className={`rounded-2xl border p-4 ${s.card}`}>
      <div className="flex items-start justify-between gap-2 mb-3">
        <div className="flex items-center gap-3">
          <div className={`w-10 h-10 rounded-full flex items-center justify-center text-white text-sm font-bold flex-shrink-0 ${s.avatar}`}>
            {contact.initials}
          </div>
          <div>
            <p className="text-sm font-bold text-gray-900 leading-tight">{contact.name}</p>
            <p className="text-xs text-gray-500 leading-tight mt-0.5">{contact.role}</p>
          </div>
        </div>
        <span className={`text-[9px] font-bold uppercase tracking-widest border rounded-md px-2 py-0.5 flex-shrink-0 mt-0.5 ${s.badge}`}>
          Tier {tier.number}
        </span>
      </div>

      <div className="space-y-1.5 pl-1">
        {contact.email && (
          <div>
            <div className="flex items-center gap-2">
              {/* Envelope icon */}
              <svg className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75" />
              </svg>
              <a href={`mailto:${contact.email}`} className="text-xs font-medium text-blue-600 hover:underline">
                {contact.email}
              </a>
            </div>
            {contact.emailNote && (
              <p className="text-[11px] text-gray-400 pl-5 mt-0.5">{contact.emailNote}</p>
            )}
          </div>
        )}

        {contact.phone && (
          <div>
            <div className="flex items-center gap-2">
              {/* Phone icon */}
              <svg className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 6.75c0 8.284 6.716 15 15 15h2.25a2.25 2.25 0 002.25-2.25v-1.372c0-.516-.351-.966-.852-1.091l-4.423-1.106c-.44-.11-.902.055-1.173.417l-.97 1.293c-.282.376-.769.542-1.21.38a12.035 12.035 0 01-7.143-7.143c-.162-.441.004-.928.38-1.21l1.293-.97c.363-.271.527-.734.417-1.173L6.963 3.102a1.125 1.125 0 00-1.091-.852H4.5A2.25 2.25 0 002.25 4.5v2.25z" />
              </svg>
              <a href={`tel:${contact.phone.replace(/[^0-9]/g, '')}`} className="text-xs font-medium text-blue-600 hover:underline">
                {contact.phone}
              </a>
            </div>
            {contact.phoneNote && (
              <p className="text-[11px] text-gray-400 pl-5 mt-0.5">{contact.phoneNote}</p>
            )}
          </div>
        )}

        <div>
          <div className="flex items-center gap-2">
            {/* Clock icon */}
            <svg className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span className="text-xs text-gray-600">{contact.hours}</span>
          </div>
          {contact.hoursNote && (
            <p className="text-[11px] text-gray-400 pl-5 mt-0.5">{contact.hoursNote}</p>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Drawer ────────────────────────────────────────────────────────────────────

type EscalationDrawerProps = {
  open:    boolean
  onClose: () => void
}

export function EscalationDrawer({ open, onClose }: EscalationDrawerProps) {
  return (
    <>
      {/* Backdrop */}
      {open && (
        <div
          className="fixed inset-0 bg-black/30 z-40 transition-opacity"
          onClick={onClose}
        />
      )}

      {/* Slide-in panel */}
      <div
        className={`fixed top-0 right-0 h-full w-[420px] max-w-[95vw] z-50 bg-white shadow-2xl flex flex-col transition-transform duration-300 ease-in-out ${
          open ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        {/* Red header */}
        <div className="bg-red-600 px-5 py-4 flex items-start justify-between flex-shrink-0">
          <div className="flex items-start gap-3">
            <svg className="w-5 h-5 text-white flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
            </svg>
            <div>
              <p className="text-base font-bold text-white leading-tight">Escalation Directory</p>
              <p className="text-xs text-red-200 mt-0.5">Planet DDS Implementation Team</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-white/80 hover:text-white p-1 rounded-lg hover:bg-white/10 transition-colors flex-shrink-0"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Instructions */}
        <div className="px-5 py-3 border-b border-gray-100 flex-shrink-0">
          <p className="text-xs text-gray-500 leading-relaxed">
            Please work through tiers in order. Escalate to the next tier only after contacting all available resources in the current tier.
          </p>
        </div>

        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto px-5 py-5 space-y-6">
          {TIERS.map(tier => {
            const s = TIER_STYLES[tier.color]
            return (
              <section key={tier.number}>
                {/* Tier heading */}
                <div className="flex items-center gap-2 mb-3">
                  <span className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${s.dot}`} />
                  <span className={`text-[11px] font-bold uppercase tracking-widest ${s.label}`}>
                    Tier {tier.number} — {tier.label}
                  </span>
                </div>
                <div className="space-y-3">
                  {tier.contacts.map(contact => (
                    <ContactCard key={contact.initials + contact.name} contact={contact} tier={tier} />
                  ))}
                </div>
              </section>
            )
          })}
        </div>
      </div>
    </>
  )
}
