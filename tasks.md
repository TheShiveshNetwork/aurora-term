### TASKS for this pull request

DONE

1. Cleanup files
2. Cleanup functions
3. Abstraction of code
4. Rename functions and variables better
5. Create an open tabs view in the side panel
6. Do not show user in the side panel git graph
7. Git graph expand should show full height line on left which is not taking full space right now
8. Git view should contain changes, and staged in the ui
9. Git view side panel resize should be like the app side panel without taking extra space
10. the git graph should show the commit data like user, date, commit hash in columns with unified widths
11. Code mirror autocomplete to implement code suggestions
12. make the keybindings settings view use a table with the same ui styling as the other settings views
13. Dynamic automatic updates when something changes in the git to specifically update that section in the git view
14. Setup a common layout for keeping track of all the keybindings so that its not scattered around files
15. Add file save with ctrl + s and show a small not saved icon on tab if file not saved
16. Ctrl+tab or ctrl+shift+tab for tab switching
17. Setup the settings store to store the user app settings and all persistantly
18. The autocomplete options in codemirror showing twice
19. In terminal one key click is adding 4 same characters and on sending a new command it is getting print 3 or 4 times for some reason
20. Tab key not working in codemirror as it switches to the ui on tab click
21. terminal sometimes printing the first command input line twice
22. bug in settings after applying the update if its not saved, the ui changes to the original saved one, make sure that the persistant themes are loaded once and not fetched all the time.
23. sync the file updates, currently if the file is updated in the system outside the app it doesnt fetch the right recent state of the updated file.
24. in settings it is not saving the api key to os keychain / reading from there. fix it
25. when switched to agent view, switch the active file type to agent, right now the issue is that on status bar file is getting shown
26. git view discard all changes not working
27. when the agent fails to load any apis tell the user to get an api key and add it in the settings for good ux
38. Github action for release
36. Add tests for code
33. codemirror multiple cursor: See allowMultipleSelections and clickAddsSelectionRange.
35. codemirror linter
35. side by side diff view to take proper width 1/2 and allow drag resize
32. git merge editor in codemirror for merge errors
36. on saving the window reloads, fix for that
34. codemirror ai suggestions
26. whenever some error occurs anywhere show a error toast popup at bottom of the app window. do not show alerts or anything please. create a common notification ui component to implement this. also right now the abort button in the merge editor is not functional. fix that.
31. on adding new file in side panel when it gets added open the file in new tab, also implement del key click on side panel and shift delete to delete files
30. implement file drag and drop in file view and outside file view to copy and paste
40. codemirror lint fix
40. Disable the things that cant be done on new window like adding new tab, closing tabs etc on the menu options
25. settings to separate the idea between command input bar for terminal and file so that on terminal the comand input bar always opens
26. separate the command agent and the agent view

TODO

39. support for voice input

37. MAJOR: Agent improvement
38. token usage optimization

37. Operating systems compatibility (only test where it is working)
42. session management (creating new session, compaction, etc)
38. Sessions store for the workspace
39. create brain for the agent with memory, implemntation plan, etc (artifact creation)
41. supabase integration for user account creation > lazy fetch with user saved settings only once when app is installed and when settings updated update to supabase
43. Publish to microsoft store
44. In-built browser
45. Expose the app features and usage of it like browser as mcp for the built application
46. Create a website

