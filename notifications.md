# Notifications and emails (drafts)

The prototype shows these in the bell. The emails are not sent from the prototype; this is the copy and the rules for when the real system sends them. Each email links straight to the page's review or edit view.

| When | Goes to | Bell today | Email |
|---|---|---|---|
| A page is submitted for review | Team lead | Yes ("Waiting for your approval") | Yes, at once |
| The lead sends a page back | Owner | Yes ("Changes requested", with the note) | Yes, at once; the note is in the email |
| A live page is 15 days from expiring | Owner (not the lead, unless the lead owns it) | Yes ("Expiring or expired") | Yes, once, on day 15; then once a week until it is renewed or expires |
| A live page expires | Owner and team lead | Yes | Yes, once, on the day |
| An owner asks to delete a page | Team lead | Yes ("Deletion requests") | Yes, at once |
| The lead keeps a page after a deletion request | Owner | Not yet | Yes, at once |
| An owner republishes a page without review (the "Allow owner to republish" setting) | Team lead | Yes, for 7 days ("Republished by the owner") | Yes, at once |
| A page is restored from Recently deleted | Owner | Not yet | Optional |
| A page is about to leave Recently deleted for good (day 27) | Team lead | Not yet | Yes, once |

## Copy

**Submitted for review** — Subject: *{Owner} submitted "{Page}" for review.* Body: {Owner} sent "{Page}" for your review. [Review it]

**Sent back** — Subject: *"{Page}" needs changes.* Body: {Lead} sent "{Page}" back with this note: "{Note}". [Edit the page]

**Expiring in 15 days** — Subject: *"{Page}" expires in 15 days.* Body: Pages are reviewed every 180 days so staff can trust them. Check "{Page}" and send it for review, even if nothing changed. [Review the page]

**Expired** — Subject: *"{Page}" has expired.* Body: "{Page}" was last reviewed {N} days ago. It is still visible, marked expired, until it is reviewed. [Review the page]

**Deletion requested** — Subject: *{Owner} asked to delete "{Page}".* Body: {Owner} asked you to delete "{Page}". It stays until you decide. [Delete it] [Keep it]

**Deletion request kept** — Subject: *"{Page}" was kept.* Body: {Lead} decided to keep "{Page}". [Open the page]

**Owner republished** — Subject: *{Owner} republished "{Page}" without review.* Body: You allowed {Owner} to republish this page without review. Every version is in the history. [See the changes] [Require review again]

**Leaving Recently deleted** — Subject: *"{Page}" will be deleted for good in 3 days.* Body: {Name} deleted it on {date}. [Restore it]
