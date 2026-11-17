/** Read-only project UI: scientific content uses standard React/Recharts components. */
import React,{createContext,useContext,useMemo,useRef,useState} from 'react';
import ReactMarkdown from 'react-markdown';
import {toPng} from 'html-to-image';
import {ResponsiveContainer,BarChart,Bar,LineChart,Line,ScatterChart,Scatter,XAxis,YAxis,CartesianGrid,Tooltip,Cell} from 'recharts';

const ProjectContext=createContext(null);
export function ProjectProvider({snapshot,children}){
 const [appTitle,setAppTitle]=useState(snapshot.title);
 const value=useMemo(()=>({snapshot,appTitle,setAppTitle,visible:()=>true,canEdit:false,mode:'view'}),[snapshot,appTitle]);
 return <ProjectContext.Provider value={value}>{children}</ProjectContext.Provider>;
}
export const useProjectReport=()=>useContext(ProjectContext);
const color=i=>`var(--chart-${i%7+1})`;
const numeric=value=>typeof value==='number'&&Number.isFinite(value);
const display=(value,digits=3)=>value===null||value===undefined?'—':numeric(value)?Number.isInteger(value)?String(value):value.toFixed(digits):typeof value==='object'?JSON.stringify(value):String(value);
function download(name,text,type='text/plain;charset=utf-8'){
 const a=document.createElement('a'),url=URL.createObjectURL(new Blob([text],{type}));a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
function csv(rows,columns){
 const fields=columns||[...new Set(rows.flatMap(r=>Object.keys(r)))];
 const quote=value=>'"'+(typeof value==='object'&&value!==null?JSON.stringify(value):String(value??'')).replaceAll('"','""')+'"';
 return [fields.map(quote).join(','),...rows.map(row=>fields.map(key=>quote(row[key])).join(','))].join('\r\n')+'\r\n';
}
export function RichNarrative({id,value,className=''}){
 return <div id={id} className={className}><div className="rich-narrative-content"><ReactMarkdown components={{a:({href,children})=><a href={href} target={href?.startsWith('http')?'_blank':undefined} rel="noreferrer">{children}</a>}}>{(value||'').replaceAll('\\n','\n')}</ReactMarkdown></div></div>;
}
export function DataTable({rows=[],columns,searchable=true}){
 const [search,setSearch]=useState(''),[sort,setSort]=useState(null),[limit,setLimit]=useState(30);
 const cols=columns||[...new Set(rows.flatMap(row=>Object.keys(row)))].slice(0,12).map(field=>({field,label:field}));
 let selected=search?rows.filter(row=>JSON.stringify(row).toLowerCase().includes(search.toLowerCase())):rows;
 if(sort){selected=[...selected].sort((a,b)=>{const x=a[sort.field],y=b[sort.field];return (numeric(x)&&numeric(y)?x-y:String(x??'').localeCompare(String(y??'')))*sort.direction;});}
 return <div className="project-table"><div className="table-controls">{searchable&&<label>搜索数据<input aria-label="搜索表格" value={search} onChange={e=>{setSearch(e.target.value);setLimit(30);}}/></label>}<span>{selected.length} 条记录</span><button type="button" onClick={()=>download('table.csv',csv(selected))}>下载CSV</button></div><div className="table-scroll"><table><thead><tr>{cols.map(col=><th key={col.field} aria-sort={sort?.field===col.field?(sort.direction===1?'ascending':'descending'):'none'}><button type="button" onClick={()=>setSort(s=>({field:col.field,direction:s?.field===col.field?-s.direction:1}))}>{col.label||col.field}</button></th>)}</tr></thead><tbody>{selected.slice(0,limit).map((row,index)=><tr key={String(row.case_id||row.id||'row')+':'+index}>{cols.map(col=><td key={col.field}>{col.renderCell?col.renderCell(row[col.field],row):display(row[col.field])}</td>)}</tr>)}</tbody></table></div>{limit<selected.length&&<button type="button" onClick={()=>setLimit(n=>n+100)}>显示更多</button>}</div>;
}
export function DataComponent({id,title,queryId,queryIds,sourceRows,sourceRowsByQuery,displayRows,showHeading=true,kind,children,className=''}){
 const {snapshot}=useProjectReport(),[open,setOpen]=useState(false),host=useRef(null);
 const ids=queryIds||[queryId].filter(Boolean),query=snapshot.queries[queryId];
 const rows=sourceRows||sourceRowsByQuery?.[queryId]||query?.rows||displayRows||[];
 async function saveFigure(){const url=await toPng(host.current,{pixelRatio:2,backgroundColor:getComputedStyle(document.body).backgroundColor||'#ffffff',filter:node=>!node.classList?.contains('component-actions')});const a=document.createElement('a');a.href=url;a.download=(id||'figure')+'.png';a.click();}
 return <section ref={host} id={id} data-component-id={id} className={'dashboard-component project-component '+className}>
  <div className="component-header">{showHeading&&title?<h3>{title}</h3>:<span/>}<div className="component-actions"><button type="button" onClick={()=>setOpen(v=>!v)} aria-expanded={open}>数据与方法</button>{kind==='chart'&&<button type="button" onClick={saveFigure}>保存PNG</button>}</div></div>
  {children}
  {open&&<div className="project-evidence" role="region" aria-label={(title||id)+' 数据与方法'}>{ids.map(key=>{const data=snapshot.queries[key];return <div key={key}><h4>{data?.label||key}</h4>{data?.source?.metricDefinitions?.map((item,index)=><p key={index}><strong>{item.label}：</strong>{item.definition}</p>)}</div>;})}<DataTable rows={rows}/></div>}
 </section>;
}
export const ReportSection=props=><DataComponent {...props}/>;

function Heatmap({rows,spec}){
 const xs=[...new Set(rows.map(row=>row[spec.x]))],ys=[...new Set(rows.map(row=>row[spec.series]??''))];
 if(spec.categoryOrder)xs.sort((a,b)=>spec.categoryOrder.indexOf(a)-spec.categoryOrder.indexOf(b));
 const order=spec.reverseRows?[...ys].reverse():ys,lookup=new Map(rows.map(row=>[JSON.stringify([row[spec.x],row[spec.series]??'']),row[spec.y]]));
 const values=rows.map(row=>row[spec.y]).filter(numeric),min=spec.colorDomain?.[0]??Math.min(...values),max=spec.colorDomain?.[1]??Math.max(...values);
 return <div className="heatmap-scroll"><table className="project-heatmap"><thead><tr><th/>{xs.map(x=><th key={x}>{x}</th>)}</tr></thead><tbody>{order.map(y=><tr key={y}><th>{y}</th>{xs.map(x=>{const value=lookup.get(JSON.stringify([x,y])),intensity=numeric(value)?Math.max(0,Math.min(100,(value-min)/(max-min||1)*100)):0;return <td key={x} title={`${y} · ${x}：${display(value,spec.valueDecimals??2)}`} style={{background:numeric(value)?`color-mix(in srgb,${spec.baseColor||color(0)} ${intensity}%,var(--background))`:'var(--muted)',color:intensity>60?'#fff':'var(--text)'}}>{spec.showValues?display(value,spec.valueDecimals??2):numeric(value)?'':'—'}</td>;})}</tr>)}</tbody></table><div className="chart-axis-note">{spec.xLabel} {spec.yLabel&&' · '+spec.yLabel} · {display(min)}—{display(max)}</div></div>;
}
function Plot({rows,spec,height=330}){
 const [hidden,setHidden]=useState(new Set());
 const groups=spec.series?[...new Set(rows.map(row=>String(row[spec.series])))]:['value'];
 const active=groups.filter(name=>!hidden.has(name));
 const groupColor=name=>spec.colors?.[name]||color(groups.indexOf(name));
 const legend=groups.length>1?<div className="project-legend">{groups.map(name=><button type="button" key={name} aria-pressed={!hidden.has(name)} onClick={()=>setHidden(old=>{const next=new Set(old);next.has(name)?next.delete(name):next.add(name);return next;})} style={{opacity:hidden.has(name) ? 0.4 : 1}}><i style={{background:groupColor(name)}}/>{name}</button>)}</div>:null;
 if(spec.type==='heatmap')return <Heatmap rows={rows} spec={spec}/>;
 const tick={fill:'var(--text)',fontSize:12},stroke='var(--border)',tip={background:'var(--surface)',border:'1px solid var(--border-strong)',borderRadius:10,color:'var(--text)'};
 const tooltip=<Tooltip contentStyle={tip} formatter={(value,name)=>[display(value,spec.valueDecimals??2),name]}/>;
 if(spec.type==='scatter')return <>{legend}<div className="project-plot" style={{height}}><ResponsiveContainer width="100%" height="100%"><ScatterChart margin={{top:15,right:25,bottom:45,left:25}}><CartesianGrid stroke={stroke} strokeDasharray="3 3"/><XAxis type="number" dataKey={spec.x} name={spec.xLabel||spec.x} tick={tick} domain={spec.startAtZero?[0,'auto']:['auto','auto']} label={{value:spec.xLabel,position:'bottom',offset:22,fill:'var(--text)',fontSize:12}}/><YAxis type="number" dataKey={spec.y} name={spec.yLabel||spec.y} tick={tick} domain={spec.startAtZero?[0,'auto']:['auto','auto']} label={{value:spec.yLabel,angle:-90,position:'insideLeft',offset:-10,fill:'var(--text)',fontSize:12}}/>{tooltip}{active.map(group=><Scatter key={group} name={group==='value'?spec.yLabel:group} data={rows.filter(row=>(!spec.series||String(row[spec.series])===group)&&numeric(row[spec.x])&&numeric(row[spec.y]))} fill={groupColor(group)} fillOpacity={.65}/>)}</ScatterChart></ResponsiveContainer></div></>;
 const categories=[...new Set(rows.map(row=>row[spec.x]))];if(spec.categoryOrder)categories.sort((a,b)=>spec.categoryOrder.indexOf(a)-spec.categoryOrder.indexOf(b));if(categories.every(numeric))categories.sort((a,b)=>a-b);
 const map=new Map(categories.map(value=>[value,{category:value}]));
 for(const row of rows){const group=spec.series?String(row[spec.series]):'value';if(numeric(row[spec.y]))map.get(row[spec.x])['s'+groups.indexOf(group)]=row[spec.y];}
 const data=[...map.values()],horizontal=spec.type==='horizontalBar';
 const catAxis=horizontal?<YAxis type="category" dataKey="category" width={145} tick={tick} interval={0}/>:<XAxis dataKey="category" tick={tick} interval="preserveStartEnd" label={{value:spec.xLabel,position:'bottom',offset:20,fill:'var(--text)',fontSize:12}}/>;
 const numberAxis=horizontal?<XAxis type="number" tick={tick} domain={spec.startAtZero?[data.some(row=>Object.values(row).some(v=>numeric(v)&&v<0))?'auto':0,'auto']:['auto','auto']} label={{value:spec.xLabel,position:'bottom',offset:20,fill:'var(--text)',fontSize:12}}/>:<YAxis type="number" tick={tick} domain={spec.startAtZero?[0,'auto']:['auto','auto']} label={{value:spec.yLabel,angle:-90,position:'insideLeft',offset:-8,fill:'var(--text)',fontSize:12}}/>;
 const chartProps={data,margin:{top:15,right:25,bottom:45,left:horizontal?0:25}};
 return <>{legend}<div className="project-plot" style={{height}}><ResponsiveContainer width="100%" height="100%">{spec.type==='line'?<LineChart {...chartProps}><CartesianGrid stroke={stroke} strokeDasharray="3 3"/>{catAxis}{numberAxis}{tooltip}{active.map(group=><Line key={group} dataKey={'s'+groups.indexOf(group)} name={group==='value'?spec.yLabel:group} stroke={groupColor(group)} dot={false} strokeWidth={2} connectNulls={false}/>)}</LineChart>:<BarChart {...chartProps} layout={horizontal?'vertical':'horizontal'}><CartesianGrid stroke={stroke} strokeDasharray="3 3"/>{catAxis}{numberAxis}{tooltip}{active.map(group=><Bar key={group} dataKey={'s'+groups.indexOf(group)} name={group==='value'?(spec.yLabel||spec.xLabel):group} fill={groupColor(group)} radius={horizontal?[0,4,4,0]:[4,4,0,0]}>{!spec.series&&data.map((row,index)=><Cell key={index} fill={spec.colors?.[row.category]||groupColor(group)}/>)}</Bar>)}</BarChart>}</ResponsiveContainer></div></>;
}
export function EvidenceChart({rows,spec,queryId,children,height,...props}){
 const {snapshot}=useProjectReport(),values=rows||snapshot.queries[queryId]?.rows||[];
 return <DataComponent {...props} queryId={queryId} kind="chart" displayRows={values}><div className="evidence-chart" data-chart-type={spec.type}>{values.length?<Plot key={JSON.stringify(spec)} rows={values} spec={spec} height={height}/>:<p>当前范围没有数据。</p>}</div>{children}</DataComponent>;
}
