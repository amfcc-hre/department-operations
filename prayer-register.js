(function () {
  'use strict';
  var api=null,data=null,registerDirty=false,notesDirty=false,loading=false,saving=false,timer=null,sequence=0;
  var labels={unmarked:'Not marked',present:'Present',absent:'Absent',excused:'Excused'};
  function el(id){return document.getElementById(id);}
  function session(){return api&&api.getSession();}
  function monitor(){var s=session();return !!(s&&s.department&&s.department.slug==='class-monitors');}
  function allowed(){var s=session();return !!(s&&(monitor()||['management','student_leadership','administrator'].indexOf(s.role)>=0));}
  function schoolToday(){return new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Harare',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());}
  function previousDate(iso,days){var d=new Date(iso+'T12:00:00Z');d.setUTCDate(d.getUTCDate()-days);return d.toISOString().slice(0,10);}
  function displayDate(iso){return new Date(iso+'T12:00:00Z').toLocaleDateString('en-GB',{timeZone:'Africa/Harare',weekday:'short',day:'numeric',month:'short',year:'numeric'});}
  function when(value){return value?new Date(value).toLocaleString('en-GB',{timeZone:'Africa/Harare',day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'}):'Not saved yet';}
  function message(text,bad){el('prayer-message').textContent=text;el('prayer-message').className='prayer-message'+(bad?' error':'');}
  function node(tag,text,className){var n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(className)n.className=className;return n;}
  function dirty(){return registerDirty||notesDirty;}
  function confirmDiscard(){return !dirty()||window.confirm('Discard the register or note changes that have not been saved?');}
  function dates(today){
    var selected=el('prayer-date').value;el('prayer-date').replaceChildren();
    for(var i=0;i<4;i++){var date=previousDate(today,i),option=node('option',(i===0?'Today · ':'')+displayDate(date));option.value=date;el('prayer-date').appendChild(option);}
    if(selected>=previousDate(today,3)&&selected<=today)el('prayer-date').value=selected;
  }
  function renderCounts(){
    var counts={unmarked:0,present:0,absent:0,excused:0};(data.students||[]).forEach(function(r){counts[r.attendance]++;});
    el('prayer-summary').replaceChildren();[['Students',(data.students||[]).length],['Present',counts.present],['Absent',counts.absent],['Excused',counts.excused],['Not marked',counts.unmarked]].forEach(function(item){var card=node('div',undefined,'prayer-stat');card.appendChild(node('strong',String(item[1])));card.appendChild(node('span',item[0]));el('prayer-summary').appendChild(card);});
  }
  function renderRows(){
    var body=el('prayer-rows'),q=el('prayer-search').value.toLowerCase().trim();body.replaceChildren();
    (data.students||[]).filter(function(row){return (row.student_name+' '+row.registration_number).toLowerCase().indexOf(q)>=0;}).forEach(function(row){
      var tr=node('tr');tr.appendChild(node('td',row.student_name));tr.appendChild(node('td',row.registration_number));
      var status=node('td');status.appendChild(node('span',row.campus_status==='OUT'?'Off campus':row.campus_status==='IN'?'On campus':'Status not captured','prayer-badge '+(row.campus_status==='OUT'?'amber':'neutral')));
      if(row.bed_rest)status.appendChild(node('span','Bed rest','prayer-badge amber'));tr.appendChild(status);
      var cell=node('td');
      if(data.can_edit){var select=node('select');select.setAttribute('aria-label','Attendance for '+row.student_name);Object.keys(labels).forEach(function(key){var o=node('option',labels[key]);o.value=key;select.appendChild(o);});select.value=row.attendance;select.disabled=saving;
        select.addEventListener('change',function(){row.attendance=select.value;registerDirty=true;renderCounts();message('Register has unsaved changes.');});cell.appendChild(select);
      }else cell.appendChild(node('span',labels[row.attendance]));tr.appendChild(cell);body.appendChild(tr);
    });
    if(!body.children.length){var empty=node('tr'),td=node('td',data.prayer_scheduled?'No students match this search.':'4AM prayer is scheduled Monday to Friday.');td.colSpan=4;empty.appendChild(td);body.appendChild(empty);}
  }
  function render(){
    if(!data)return;dates(data.school_today);el('prayer-date').value=data.prayer_date;el('prayer-year').value=String(data.class_year);el('prayer-year').disabled=monitor()||saving;
    el('prayer-date').disabled=saving;el('prayer-context').textContent='Year '+data.class_year+' · '+displayDate(data.prayer_date)+' · 4AM prayer';
    el('prayer-state').textContent=!data.prayer_scheduled?'No prayer register today':data.register_saved?'Saved '+when(data.updated_at)+(data.recorded_by?' by '+data.recorded_by:''):'No register saved for this date';
    el('prayer-help').textContent=data.can_edit?'Mark each student and save the register. Campus and bed-rest status show the current status. Saving records a snapshot.':data.prayer_scheduled?'Read-only register. Historical status shows the saved snapshot.':'4AM prayer runs Monday to Friday. No attendance register is required for this date.';
    el('prayer-save').hidden=!data.can_edit;el('prayer-save').disabled=saving;el('prayer-mark-present').hidden=!data.can_edit;el('prayer-mark-present').disabled=saving;
    el('prayer-export').disabled=saving||!data.prayer_scheduled;el('prayer-actor-field').hidden=!monitor();
    el('prayer-notes-section').hidden=!monitor();
    if(monitor()){
      el('prayer-notes').readOnly=data.prayer_date!==data.school_today||saving;
      if(!notesDirty)el('prayer-notes').value=(data.notes||{}).body||'';
      el('prayer-notes-save').hidden=data.prayer_date!==data.school_today;el('prayer-notes-save').disabled=saving;
      el('prayer-notes-state').textContent=(data.notes||{}).revision?'Saved '+when(data.notes.updated_at):'No notes saved for this date';
    }
    renderCounts();renderRows();
  }
  async function load(automatic){
    if(!allowed()||loading||saving||(automatic&&dirty()))return;
    if(!automatic&&!confirmDiscard())return;
    var s=session(),current=++sequence;loading=true;
    ['prayer-date','prayer-year','prayer-save','prayer-notes-save','prayer-mark-present','prayer-export','prayer-refresh'].forEach(function(id){el(id).disabled=true;});
    el('prayer-notes').readOnly=true;Array.from(el('prayer-rows').querySelectorAll('select')).forEach(function(select){select.disabled=true;});
    try{
      var result=await api.rpc('ops_prayer_register',{p_session_token:s.session_token,p_prayer_date:el('prayer-date').value||null,p_class_year:monitor()?s.class_year:Number(el('prayer-year').value||1)});
      if(current!==sequence||session()!==s)return;
      if(result.status!=='success')throw new Error(result.message||'The register could not be loaded.');
      data=result;registerDirty=false;notesDirty=false;render();
      message('Last refreshed '+when(new Date().toISOString())+'. Live view refreshes every 15 seconds.');
    }catch(error){if(current===sequence){message(error.message||'The register could not be reached.',true);if(error.message&&/expired|sign in/i.test(error.message))data=null;}}
    finally{if(current===sequence){loading=false;el('prayer-refresh').disabled=false;el('prayer-date').disabled=false;el('prayer-year').disabled=monitor();render();}}
  }
  async function saveRegister(){
    if(saving||!data||!data.can_edit)return;
    var actor=el('prayer-actor').value.trim();if(!actor){message('Enter the monitor name before saving.',true);el('prayer-actor').focus();return;}
    saving=true;var s=session(),current=sequence;render();
    el('prayer-refresh').disabled=true;
    try{
      var result=await api.rpc('ops_prayer_register_save',{p_session_token:s.session_token,p_prayer_date:data.prayer_date,p_class_year:data.class_year,p_rows:data.students.map(function(row){return {student_id:row.student_id,attendance:row.attendance};}),p_expected_revision:data.revision,p_actor_name:actor});
      if(current!==sequence||session()!==s)return;if(result.status!=='success')throw new Error(result.message||'The register was not saved.');
      var note=data.notes;data=result;if(notesDirty)data.notes=note;registerDirty=false;message('Register saved. Management and Student Leadership can view it live.');
    }catch(error){if(current===sequence)message(error.message||'Register save failed.',true);}
    finally{if(current===sequence){saving=false;el('prayer-refresh').disabled=false;render();}}
  }
  async function saveNotes(){
    if(saving||!data||!monitor()||data.prayer_date!==data.school_today)return;
    var actor=el('prayer-actor').value.trim();if(!actor){message('Enter the monitor name before saving notes.',true);el('prayer-actor').focus();return;}
    var text=el('prayer-notes').value;saving=true;var s=session(),current=sequence;render();
    el('prayer-refresh').disabled=true;
    try{
      var result=await api.rpc('ops_class_monitor_notes_save',{p_session_token:s.session_token,p_note_date:data.prayer_date,p_body:text,p_expected_revision:(data.notes||{}).revision||0,p_actor_name:actor});
      if(current!==sequence||session()!==s)return;if(result.status!=='success')throw new Error(result.message||'Notes were not saved.');
      data.notes=result.notes;notesDirty=false;message('Notes saved for your year group.');
    }catch(error){if(current===sequence)message(error.message||'Notes save failed.',true);}
    finally{if(current===sequence){saving=false;el('prayer-refresh').disabled=false;render();}}
  }
  function csvCell(value){var text=String(value==null?'':value);if(/^[\s]*[=+@-]/.test(text))text="'"+text;return '"'+text.replace(/"/g,'""')+'"';}
  function csv(){
    var rows=[['Prayer date','Time','Year group','Student','Registration','Attendance','Campus status','Bed rest','Saved by','Last saved']];
    (data.students||[]).forEach(function(row){rows.push([data.prayer_date,'04:00',data.class_year,row.student_name,row.registration_number,labels[row.attendance],row.campus_status==='OUT'?'Off campus':row.campus_status==='IN'?'On campus':'Status not captured',row.bed_rest?'Bed rest':'',data.recorded_by||'',data.updated_at||'']);});
    return '\uFEFF'+rows.map(function(row){return row.map(csvCell).join(',');}).join('\r\n');
  }
  function exportRegister(){
    if(!data||!data.prayer_scheduled)return;
    if(registerDirty){message('Save or reload your register changes before exporting the saved register.',true);return;}
    var blob=new Blob([csv()],{type:'text/csv;charset=utf-8'}),url=URL.createObjectURL(blob),a=node('a');a.href=url;a.download='AMFCC-4AM-Prayer-Year-'+data.class_year+'-'+data.prayer_date+'.csv';document.body.appendChild(a);a.click();a.remove();setTimeout(function(){URL.revokeObjectURL(url);},1000);
  }
  function selectionChange(){
    if(!confirmDiscard()){if(data){el('prayer-date').value=data.prayer_date;el('prayer-year').value=String(data.class_year);}return;}
    registerDirty=false;notesDirty=false;load(false);
  }
  function open(){
    if(!allowed())return;dates(data&&data.school_today||schoolToday());
    if(!el('prayer-date').value)el('prayer-date').value=schoolToday();
    if(monitor())el('prayer-year').value=String(session().class_year);
    load(true);
  }
  function reset(){sequence++;data=null;loading=false;saving=false;registerDirty=false;notesDirty=false;el('prayer-rows').replaceChildren();el('prayer-notes').value='';el('prayer-actor').value='';el('prayer-search').value='';message('');}
  function mount(options){
    if(api)return;api=options;dates(schoolToday());
    el('prayer-date').addEventListener('change',selectionChange);el('prayer-year').addEventListener('change',selectionChange);
    el('prayer-search').addEventListener('input',function(){if(data)renderRows();});
    el('prayer-refresh').addEventListener('click',function(){load(false);});el('prayer-save').addEventListener('click',saveRegister);
    el('prayer-notes-save').addEventListener('click',saveNotes);el('prayer-notes').addEventListener('input',function(){notesDirty=true;message('Notes have unsaved changes.');});
    el('prayer-export').addEventListener('click',exportRegister);
    el('prayer-mark-present').addEventListener('click',function(){if(!data||!data.can_edit||saving)return;var rows=data.students.filter(function(row){return row.attendance==='unmarked'&&row.campus_status==='IN'&&!row.bed_rest;});if(!rows.length){message('No unmarked students on campus without bed rest.');return;}if(!window.confirm('Mark '+rows.length+' unmarked students on campus as present? Check attendance before saving. Off-campus and bed-rest students will remain unchanged.'))return;rows.forEach(function(row){row.attendance='present';});registerDirty=true;render();message('Attendance changed. Save the register to share it.');});
    window.addEventListener('beforeunload',function(event){if(dirty()){event.preventDefault();event.returnValue='';}});
    timer=setInterval(function(){var view=el('view-prayer-register');if(!document.hidden&&allowed()&&view&&view.classList.contains('active'))load(true);},15000);
  }
  window.AMFCCPrayerRegister={mount:mount,open:open,reset:reset,allowed:allowed,confirmLeave:confirmDiscard};
})();
