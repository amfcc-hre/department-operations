# AMFCC Department Operations

The protected operating platform for AMFCC departments, HODs, Student Leadership, Management and School Administration.

**Repository:** [amfcc-hre/amfcc_department_operations](https://github.com/amfcc-hre/amfcc_department_operations)  
**Live site:** [AMFCC Department Operations](https://amfcc-hre.github.io/amfcc_department_operations/)  
**Public POD board:** [Live POD Task Board](https://amfcc-hre.github.io/amfcc_department_operations/pod.html)

## Purpose

Department Operations is the main staff work platform. It replaces the former Staff Services page and the separate Student Leadership and School Administrator dashboards.

It connects departmental work, student allocations, task planning, daily reporting, weekly and monthly reporting, department-specific tools and student-operations administration in one system.

Kitchen staff and Clinic staff work belongs here. Student self-service meal check-in, meal collection and personal gate-pass requests remain in Student Services.

## Access model

| Workspace | Main permissions |
| --- | --- |
| Department | Simple task submission, own task list, daily and period reports, and department-specific operational tools. Conference Accommodation and Student Accommodation also receive the protected accommodation register. |
| Student Leadership | One-page task approval and allocation, cohort availability, weekly duty rosters, standing-department setup, student-services operations and task exports |
| Management | Operational oversight, senior gate-pass actions, reports, planning and management actions |
| School Administration | Clickable overview, open task list, weekly duty rosters, student and pass summaries, report attention, student fee status, Administrator pass decisions, system settings and department PIN management |

- Every department has one shared four-digit PIN.
- Individual staff PINs are not required.
- On first use, School Administration issues an eight-digit one-time setup code. The department enters that code once and chooses its own four-digit PIN.
- A one-time setup code expires after 24 hours, is locked for 15 minutes after five incorrect attempts and cannot be reused.
- School Administration can issue the same self-service flow when an established department needs to choose a replacement PIN.
- Name fields are exact database lookups. Registration numbers are not requested outside Student Services.
- The staff directory is available only in reporting fields. Staff never appear in task, allocation or department-member lists.
- Departments cannot request named students.
- HODs can maintain their own student-member roster. Student Leadership, Management and School Administration can maintain every department roster.
- School Administration can issue department setup codes or replace department PINs directly from the Department access section.
- IT Administration can change every role and department PIN from the separate IT Administration site.

## Standard department workspace

Every department receives a workspace named and organised around its work. Standard capabilities include:

- Current work overview and notifications.
- One short form to submit work for a working day without choosing a session.
- Normal, Important or Crucial priority. Crucial work requires an explanation.
- Recurring work with daily, weekly, monthly or quarterly frequency.
- Unexpected same-day work.
- Daily departmental reports.
- Previous report history.
- Weekly and monthly reports built from daily records.
- Blank planning, stock and activity tools that the department configures itself.
- Internal stock or material transfers between departments.
- Management actions created from reviewed reports.

Department tool lists intentionally start empty. Users enter their own item names, categories, units, plan types and record types instead of selecting preloaded assumptions.

## Configured departments

### Main operational and project workspaces

- IT Department
- Husbandry
- Horticulture
- Maintenance
- Painting
- Flowers & Orchids
- Poultry
- Building
- Media
- Chairs & Upholstery
- Kitchen
- Clinic
- Bakery
- Tuckshop
- Fisheries
- Transport
- Finance / Accounts
- Conference Accommodation

### Additional workspaces from the 2026-27 HOD register

- Offices
- Administrator's Office
- Motor Mechanics
- Grounds
- Lawn Cutting
- Security
- Immigration
- Chapel
- Compassion House
- Toilets
- Student Accommodation
- Legacy Cafe
- Protocol
- Sports
- Generator
- Flags

Every workspace above has department-specific headings, planning language, stock or resource tools and activity records. Tool lists start blank and the department enters its own options.

Finance / Accounts is currently limited to its departmental operations and spending records. This platform does not replace the school's accounting system.

## Accommodation Operations

Conference Accommodation and Student Accommodation open directly to the protected student accommodation register after using their existing department PIN.

- Each building is shown as a separate choice. Only one building and the names assigned to it are displayed at a time.
- An Unassigned view lists active students who do not currently have an accommodation allocation.
- Users can filter the selected building by student name, room, bed or allocation status.
- A student must be chosen through the same exact searchable database-record lookup used by gate passes.
- The department can assign or change the building, room, bed and accommodation status, or remove the current assignment.
- Status options are Waiting, Allocated, Checked in and Checked out.
- Every change records the session role, responsible department, before value, after value and time in the audit log.
- Fees, medical information, sponsor details and private School Administration notes are not returned to the accommodation departments.

The register uses the existing `students` and `accommodation_allocations` records. It does not create a second student list, a new login or a new role system.

### Horticulture structure

Horticulture is the main department and uses one Horticulture PIN.

- Open Field reports separately under Horticulture.
- Greenhouses reports separately under Horticulture.
- Greenhouse 1, Greenhouse 2 and Greenhouse 3 are subsections of Greenhouses.
- Open Field and Greenhouses do not appear as separate login workspaces.

### Poultry structure

Poultry is the main department and uses one Poultry PIN.

- Layers reports separately under Poultry.
- Broilers reports separately under Poultry.
- Layers and Broilers do not appear as separate login workspaces.
- Department members, task requests, feed, supplies and operational tools are managed from the one Poultry workspace.

Prayer, Church Representative, Orchard, International Student Representatives, Gongs, Hosting and Logistics are retired and do not appear as departments or login workspaces. Their historical records are preserved for audit purposes.

## Kitchen Operations

Kitchen is a daily service, so its first page is Meal service rather than the general task page.

- View separate preparation check-in counts for Breakfast, Lunch and Break-fast 4pm.
- View actual meal-portion collection totals, including anonymous child portions.
- View recent student collections and any child portions attached to the collector.
- Assist a student with a connected 2D scanner or five-digit registration number when required.
- Open the dedicated full-screen scanner in `meal-checkin.html`.
- Export meal-attendance records.
- Plan daily or weekly meals.
- Track ingredients, food received, food used, wastage and remaining stock.
- Submit occasional tasks only when Kitchen needs work outside its normal daily service.

The Kitchen staff scanner uses the protected Kitchen Operations session and does not depend on the Student Services repository. It records collection, not the earlier planning check-in. Conference Mode disables both the scanner and all collection inserts.

During School Term Mode, students first use Meal Check-In for Breakfast, Lunch or Break-fast 4pm. Supper has no advance check-in because Kitchen cooks for everyone. Students then use Meal Collection when they arrive: they select their exact record, can add one other student, enter child portions by number and show Kitchen the full-screen confirmation.

Holiday Mode disables advance Meal Check-In but leaves Meal Collection available. Conference Mode disables both because everyone is cooked for automatically.

## Clinic Operations

Clinic opens directly to its protected register.

- Search students by name or registration number.
- Start or end bed-rest permission.
- View students currently on bed rest.
- Track medication and material stock.
- Record non-confidential Clinic activity totals.
- Submit Clinic reports and request extra help when required.

Student Leadership cannot see confidential Clinic notes.

## IT Department Operations

The IT Department workspace includes the service desk, planning, activity records and a built-in Asset register tab.

The register preserves the spreadsheet fields: Description, Asset Tag ID, Quantity, Status, Site, Location, Brand, Category, Model and Serial No. It adds an editable minimum-stock level. Search covers every field, and filters cover category, site, location, status and stock level. The dashboard shows entry and unit counts, low-stock and out-of-stock entries, and category and site totals.

IT users can type a quantity or use the up/down buttons. Typed changes save on Enter or when leaving the field; arrow changes save immediately. Empty minimum levels turn low-stock alerts off for that entry, while zero quantities always show an out-of-stock alert. Imported entries begin with minimum stock set to 2. Blank spreadsheet locations stay blank; users can enter a shelf, room or installation point through Edit details. New sites and locations become filter options automatically.

Inventory lives in `ops_it_assets`. Apply `database_migrations/018_it_asset_register.sql` before deploying the frontend. Spreadsheet rows are imported directly into the protected database; live inventory and serial numbers are not included in public source files. IT Department sessions can update the register, Management and Administrator sessions can read it, and other departments have no access. Session validation runs inside the private API functions; public wrappers use security invoker. Direct table access is denied. Updates lock the row and check its revision to prevent stale overwrites, and successful edits enter the existing operations audit log. The tab refreshes every 30 seconds while visible, without replacing unfinished input.

The IT tools page and School Administration overview now link to the inbuilt asset and documentation registers. The asset register replaces the AssetTiger launcher. Bitwarden remains available for the IT password manager. Passwords, recovery codes, emergency-access documents and vault exports must never be entered into Department Operations, its activity notes, Supabase or GitHub.

## Tasks and student allocations

- Planned requests for the next day must be submitted by 6:00 pm in the `Africa/Harare` time zone.
- Work that appears after the deadline is submitted as an Unexpected task.
- Departments choose only the working day. They do not choose a work session.
- Student Leadership chooses the session and may place the work later in the day or week.
- Configured department members are added to the task total automatically. Departments enter only the number of extra students needed.
- Departments cannot request specific students or specific names.
- Student Leadership can approve the requested number or reduce it to the number available.
- Student Leadership sees availability for 1st year men, 1st year ladies, 2nd year men and 2nd year ladies.
- Group allocations use cohort labels. The task does not need to list every student name.
- Approval, session choice, approved total and the four cohort allocations are completed on the same task card.
- The planner has daily and weekly visual views. Published task cards can be dragged between sessions in the daily view and between days in the weekly view. The Move button provides an iPad-friendly alternative.
- The planner refreshes the request and approved-work data every 30 seconds while Student Leadership is signed in.
- Student Leadership can export the filtered task list as a CSV file for Excel.
- Student Leadership can enter the Prefect on Duty and Senior Prefect on Duty for the current week or future weeks.
- A department can be marked always on for every day and session, or for selected days and sessions. Its configured cohort counts are reserved before the remaining group numbers are shown.

School Administration opens to Overview. Its navigation intentionally excludes Daily report, Meal scanner, Session requests, Department tools and Transfers. The overview links directly to open tasks, on-campus and off-campus students, pending and overdue passes, duty rosters, report attention, notifications, work attention, the asset register and the documentation register.

Student Leadership does not review or approve department reports. Management and School Administration retain report attention and approval work.

## Public live POD board

`pod.html` is a read-only, no-PIN view for the person running the working day.

- Shows the current Prefect on Duty and Senior Prefect on Duty.
- Shows only approved or in-progress work for today, grouped by session.
- Shows the task, department and work location.
- Shows extra student allocations as anonymous totals such as `3 first year men`.
- Shows configured department members by exact name.
- Refreshes automatically every 15 seconds and includes a manual Refresh button.
- Does not expose registration numbers, report data, notes, PINs or editing controls.

## Student Services operations

The Student services section is the supported replacement for the former staff dashboards.

Every people list can be narrowed by gender, class and current campus status. These filters work together. A group gate pass appears when at least one person on the pass matches all three selected person filters.

Student Leadership can work with:

- campus status and outing type;
- accommodation information;
- gate-pass viewing;
- gate duty and recent movements; and
- permitted operational exports.

Management can perform the senior gate-pass decision assigned to the Principal, Dean or Director role.

School Administration also receives:

- student fee status;
- School Administrator gate-pass decisions;
- pass departure and return amendments;
- School Term or Holiday settings;
- the Conference Mode overlay; and
- student-services and meal-attendance exports.

Pass emails are targeted to the person who must act:

- School Administration receives new-pass emails and one unresolved-pending reminder 12 hours after the proposed departure time.
- Management receives a separate actionable gate-pass email. After entering the Management PIN, the Principal, Dean or Director can review the pass and record an approval or rejection.
- Student Leadership receives overdue-return alerts and Tanaka or Amalinda Shops alerts after 70 minutes without a later check-in.
- Routine student status emails are not copied to School Administration or Student Leadership.

Student Leadership cannot see fees or confidential Clinic notes.

## Operating modes

The platform always has one base mode. Conference Mode is an optional overlay.

| Mode | Operational effect |
| --- | --- |
| School Term Mode | Meal Check-In is available for Breakfast, Lunch and Break-fast 4pm, alongside standard gate-pass and work rules |
| Holiday Mode | Advance Meal Check-In is disabled; Meal Collection remains available; Morning and Afternoon task slots and holiday gate-pass rules apply |
| Conference Mode overlay | Meal Check-In and Meal Collection are disabled, manual-work sessions and group allocations are removed, and all active work is treated as Emergency work |

Conference Mode can be enabled alongside School Term Mode or Holiday Mode. It is not a third base mode. The selected base mode continues to control gate-pass rules.

## Jira integration

Department reports and management actions can be placed in the Jira outbox for synchronisation when Jira integration is configured.

- Jira configuration is optional.
- The site remains usable when Jira is not configured.
- Student names are not sent to Jira.
- The existing outbox worker is not included in this static repository package.

## Security model

- Browser files contain a Supabase publishable key only.
- Never add a Supabase secret key or legacy `service_role` key to this repository.
- Never store password-manager secrets, recovery codes, AssetTiger API keys or vault exports in this repository or in Department Operations records.
- PINs are verified in the database and are not stored in browser files.
- One-time setup codes and department PINs are stored as salted bcrypt hashes. The setup code is shown only when School Administration generates it.
- Changing a department PIN through either approved method revokes that department's earlier Operations sessions.
- A successful login receives a temporary Operations session token.
- Protected database functions validate the session role and department before completing an action.
- The raw PIN is not retained and is not sent again after login.
- Staff names are used for operational ownership and audit records, not as authentication credentials.

## Main repository files

| File | Purpose |
| --- | --- |
| `index.html` | All protected Operations workspaces |
| `operations.js` | Login, role permissions, tasks, reports, tools and student-services behaviour |
| `operations.css` | Operations layout and responsive styling |
| `meal-checkin.html` | Full-screen protected Kitchen collection scanner |
| `meal-checkin.js` | Kitchen card-scanning and collection workflow |
| `meal-checkin.css` | Full-screen scanner styling |
| `pod.html` | Public read-only live POD task board |
| `pod.js` | Live duty and approved-task feed |
| `pod.css` | Responsive POD board styling |
| `sw.js` | Service-worker caching for the Operations site |
| `manifest.webmanifest` | Installable web-app details |
| `shared_config.js` | Supabase project URL and publishable key |
| `shared_ui.css` | Shared interface styling |
| `supabase/migrations/202609010002_student_meal_check_in.sql` | Separate School Term check-in counts and mode enforcement |
| `supabase/migrations/202609010003_targeted_pass_email_alerts.sql` | Targeted Admin and Student Leadership email rules |
| `supabase/migrations/202609020002_department_first_login_pin_setup.sql` | Protected first-login codes and department-owned PIN setup |
| `supabase/functions/pass-email-worker/` | Email rendering and delivery for pass and movement alerts |

## Deployment with GitHub Pages

1. Open the existing public repository `amfcc_department_operations` under the `amfcc-hre` account.
2. Upload every file from this folder to the repository root.
3. Keep all filenames and folder levels unchanged.
4. Open **Settings > Pages** in GitHub.
5. Select **Deploy from a branch**.
6. Select the `main` branch and the `/ (root)` folder.
7. Wait for GitHub Pages to publish the site.
8. Open the live-site link above in a private browser window.

Apply `supabase/migrations/202609020002_department_first_login_pin_setup.sql` once before uploading the matching website files. Do not run a migration again after it appears in the project's migration history.

## First-use checks

1. Open `pod.html` without a PIN and confirm today's POD, Senior POD and approved work appear.
2. Sign in as Student Leadership and confirm the four-digit PIN works.
3. Sign in as School Administration and confirm fee status and settings are visible.
4. Open Department logins, generate a first-login code for a department without a PIN and record the displayed code privately.
5. Sign out, choose that department, enter the one-time code, choose and confirm a new four-digit PIN, and confirm the workspace opens.
6. Sign out again and confirm the new department PIN opens the workspace through the normal login form.
7. Confirm the used setup code cannot be reused and no longer appears as active to School Administration.
8. Submit a test work request without choosing a session.
9. Sign in to Horticulture and confirm one PIN opens the workspace with Open Field and Greenhouses report choices.
10. Sign in to Poultry and confirm one PIN opens the workspace with Layers and Broilers report choices.
11. Sign in to Kitchen and confirm Meal service opens first.
12. Scan a test student card and confirm the scanner becomes ready for the next card.
13. Sign in to Clinic and confirm the Clinic register opens first.
14. Confirm a next-day department request is accepted before 6:00 pm and becomes Unexpected work after the deadline.
15. Confirm Holiday Mode and Conference Mode appear as separate settings.
16. Confirm Student Leadership cannot see fee information or confidential Clinic notes.
17. In each Student services list, test the gender, class and campus-status filters together.
18. In Student Leadership, switch between daily and weekly planner views, then move a test task by drag and drop and by the Move button.
19. Open Department members and confirm an HOD can edit only their own roster while Student Leadership, Management and School Administration can edit any roster.
20. Sign in to IT Department and confirm the Asset register and Documentation tiles open their dedicated pages. Check that both tiles also appear on the School Administration overview.

## Related repositories

- [AMFCC IT Administration](https://github.com/amfcc-hre/it-admin-site): maximum-permission settings and PIN management.
- [AMFCC Student Services](https://github.com/amfcc-hre/amfcc_student_services): student meal check-in and personal gate-pass requests.
- [AMFCC Library](https://github.com/amfcc-hre/library-site): ISBN lookup, catalogue, circulation and loan reporting.

## Dedicated IT registers

`it-assets.html` and `it-documents.html` are dedicated pages using the existing Department Operations PIN session. IT tools and the School Administration overview link directly to both. A direct visit without a session shows a workspace login link. After normal login, the requested register opens automatically.

Documentation has Technical How-Tos and Technical Specifications, searchable categories, PDF/DOC/DOCX imports up to 20 MB, automatically numbered versions, change notes, upload attribution and a downloadable archive. IT Department and School Administration can import and update documents; Management can read. Earlier files are never overwritten. Row locking and the expected current version prevent competing uploads from replacing each other.

Apply `supabase/migrations/20261003160613_it_document_register.sql` and deploy the `it-document-files` Edge Function with its supplied `deno.json`. The function uses custom authentication: every upload or download validates the existing Operations session. Files are stored in the private `it-technical-documents` bucket and are streamed only after authorization. Its health endpoint returns no document data. The four supplied Word documents were imported as initial Technical Specifications versions directly into private storage. Files and their contents are not committed to GitHub.


## Vehicle checkout

Open **Vehicle checkout** from Transport, School Administration or the Administrator's Office. The same live dashboard is also shown on their overview/default workspace pages. It lists the five vehicles, people taking them out, outgoing mileage and pending key confirmations. Availability refreshes every 30 seconds while the page is open, and when it is brought back into focus.

1. Choose an available vehicle. Enter the checkout date and time, search for a student or staff member, enter the outgoing odometer reading and describe the journey. The borrower types their full name from the lookup and ticks the confirmation.
2. The vehicle becomes **Awaiting key handover**. It is reserved and cannot be checked out again. School Administration OR the Administrator's Office opens the record, enters the confirming person's name and confirms that the keys have been handed over. Only one of these workspaces is needed. The vehicle becomes **Checked out**.
3. Use **Record return**, enter the return date, time and odometer reading, and have the borrower confirm the return using their full name. The vehicle becomes **Awaiting return confirmation**.
4. School Administration OR the Administrator's Office confirms receipt of the keys. The vehicle becomes **Available** and its last confirmed mileage is updated.

All times are entered and displayed in Harare time, even when the browser uses another timezone. Outgoing mileage cannot be below the last confirmed return mileage. Return mileage cannot be below outgoing mileage. A pending checkout can be cancelled with a named actor and reason. A pending return can be corrected before the keys are confirmed. Completed records remain in searchable, paginated journey history with both signatures and named confirmations. Typed-name signatures record the borrower's acknowledgement alongside the journey.

### Files and APIs

| File or function | What to change here |
| --- | --- |
| `vehicles.html` | Standalone page headings, form fields, borrower confirmations and key confirmation wording |
| `vehicle-checkout.css` | Vehicle dashboard, card, form, mobile and dialog appearance |
| `vehicle-checkout.js` | Form behaviour, searchable student/staff picker, Harare time conversion, mileage display, history filters and action dialogs |
| `vehicle-dashboard.js` | Shared five-vehicle dashboard, refresh timing and which existing login session is used |
| `index.html` | Links and dashboard locations in the Operations workspaces |
| `operations.js` | Login return route for the standalone vehicle page |
| `sw.js` | Static cache version and vehicle page assets |
| `supabase/migrations/20261004182503_vehicle_checkout.sql` | Vehicle tables, initial vehicle names, constraints, server permissions, confirmation rules, mileage checks and audit events |
| `ops_vehicle_bootstrap` | Current availability and server-verified confirmation permissions |
| `ops_vehicle_people` | Active student and staff lookup by name or number |
| `ops_vehicle_history` | Journey search, status filters and history pagination |
| `ops_vehicle_command` | Checkout, departure key confirmation, return entry, return key confirmation and cancellation |
| `tests/vehicle_checkout.sql` | Authorization and workflow checks in a single rolled-back transaction |
| `tests/vehicle-checkout-ui.cjs` | Browser form, lookup, timezone, mobile and dashboard integration checks using local fixtures |

The additional School Administration entry points in `amfcc_student_services` use the same database APIs and shared vehicle scripts. The root `admin_index.html` dashboard opens `vehicles.html`; `administration/index.html` opens `administration/vehicles.html` for a School Administration login. The existing system session is verified on the server. Administration Staff, IT Administration, Management and Student Leadership do not acquire vehicle confirmation rights.

The tables deny direct access from public clients. The public functions are security-invoker wrappers. The restricted `vehicle_private` functions validate an unexpired, unrevoked existing Operations or School Administration session before reading or writing. A vehicle row lock, one-active-checkout unique index, per-record revision and client request ID protect against simultaneous checkouts, stale updates and accidental retries. Each action is recorded in the existing Operations audit log. No service-role key is shipped to the browser.

### If something goes wrong

- **No vehicle checkout link:** Use Transport, School Administration or the Administrator's Office. Sign out of any other workspace first.
- **Borrower missing:** Search a shorter part of the name, or the registration/staff number. Check that the person is active in the student or staff directory.
- **Signature rejected:** The borrower must type the full name shown by the selected lookup and tick the confirmation. Do not type someone else's name or leave the lookup unselected.
- **Vehicle stays unavailable after return:** An administrator must confirm actual receipt of the keys. Entering return mileage alone does not release the vehicle.
- **Incorrect pending checkout:** Open the journey, cancel it with a reason, then enter the corrected checkout. Once keys have gone out, record its return.
- **Incorrect pending return:** Open its journey and use **Correct return details**, then re-confirm the borrower signature before an administrator receives the keys.
- **Someone else updated the record:** Close the dialog, use Refresh, check the latest details and reopen the journey. The server will not overwrite another person's change.
- **Unable to connect:** Check connectivity and use Refresh. The initial connection error has a retry option; stale availability disables new actions until refreshed.
- **Session expired:** Follow the sign-in link and use the appropriate workspace PIN. Cached pages alone cannot read or update vehicle records without a valid session.

The existing recovery workflow now validates the current application files. It no longer restores an older application shell after a Fees update, so future fee-control changes preserve the vehicle dashboard and standalone links. The existing Registration Progress and Fees scripts and loader are unchanged.
