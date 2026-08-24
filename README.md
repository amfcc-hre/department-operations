# AMFCC Department Operations

The protected work platform for HODs, departments, Student Leadership and School Administration. Staff Services has been retired. Kitchen and Clinic work now lives only inside this site.

## Repository

Create a public repository named `amfcc_department_operations`, upload every file in this package to its root, and enable GitHub Pages from the `main` branch.

## Site

https://amfcc-hre.github.io/amfcc_department_operations/

## Access

- HODs and department staff choose their department and use its unique four-digit PIN.
- Student Leadership uses its existing four-digit Student Leadership PIN.
- School Administration uses its existing four-digit Administrator PIN.
- No individual staff PINs are required.
- School Administration sets or replaces each department PIN from the Department access tab.

## Student Leadership and School Administration replacement

- The Student services tab replaces the previous Student Leadership and School Administrator dashboards.
- Student Leadership retains campus status, outing type, accommodation, gate-pass viewing, gate duty, recent movements and exports.
- Management retains senior gate-pass decisions.
- School Administration also receives fee status, Administrator gate-pass approval, departure and return amendments, and school settings.
- Student Leadership cannot see fees or confidential Clinic notes.

## Department workspaces

- Every department receives a workspace labelled and organised around its real operations, plus daily reporting, report history and support requests.
- Kitchen opens directly to its own meal check-in service. A connected 2D scanner can scan student cards on the iPad, and manual registration entry remains available.
- The full-screen scanner is `meal-checkin.html` in this repository. It requires an active Kitchen or School Administration Operations session and has no Student Services repository dependency.
- Kitchen planning and stock tools are specifically labelled for menus, ingredients, food usage and wastage. Tasks remain available as an occasional secondary function.
- Clinic opens directly to its protected bed-rest register, with medication and material stock, Clinic activity records and reporting in the same workspace.
- IT, Husbandry, Horticulture, Maintenance, Painting, Flowers, Poultry, Layers, Broilers, Building, Media, Upholstery, Bakery, Tuckshop, Fisheries, Transport, Finance and Conference Centre each receive a named operational layout and department-specific labels.
- Horticulture has one workspace and one PIN. Open Field and Greenhouses submit separate reports under Horticulture. Greenhouse 1, 2 and 3 are subsections of Greenhouses.
- All lists start empty. Departments enter their own stock items, categories, plan types and record types.

## Task planning

- Planned requests for the next day close at 6:00 pm Africa/Harare time.
- Unexpected work uses the Unexpected task request type.
- Holiday mode exposes Morning and Afternoon task slots.
- Departments request a total headcount, including their members, and cannot request names.
- Student Leadership approves or edits the total and assigns 1st year men, 1st year ladies, 2nd year men or 2nd year ladies.

## Conference Mode

Conference Mode is not a calendar mode. It is an overlay on School Term or Holiday Mode. While it is on, meal planning has no deadline, manual-work sessions and group allocations are unavailable, and open or new work is treated as Emergency work with Critical priority. The selected School Term or Holiday gate-pass rules remain active.

The Supabase database migrations are already deployed. Do not run the SQL files again. The Jira outbox worker remains unchanged.
