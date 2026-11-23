// Test-only instrumentation appended to an isolated installed COPY, never the ZIP.
import Shell from 'gi://Shell';
import St from 'gi://St';
const probeEnable = UsageScopeExtension.prototype.enable;
UsageScopeExtension.prototype.enable = function () {
    probeEnable.call(this);
    const extension = this;
    const reportPath = GLib.getenv('USAGESCOPE_UI_REPORT');
    const capturePath = GLib.getenv('USAGESCOPE_UI_CAPTURE');
    if (!reportPath) return;
    GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1500, () => {
        Main.overview.hide();
        extension.indicator.button.menu.open();
        GLib.timeout_add(GLib.PRIORITY_DEFAULT, 600, () => {
          void (async () => {
            const actor = extension.indicator.button.menu.actor;
            const [x, y] = actor.get_transformed_position();
            const bars = [], text = [];
            const walk = item => {
                if (item.mapped) {
                    if (typeof item.get_text === 'function') text.push(item.get_text());
                    if (item.has_style_class_name?.('usagescope-fill')) {
                        const color = item.get_theme_node().get_background_color();
                        bars.push({width:item.width,height:item.height,x:item.x,track:item.get_parent().width,
                            trackHeight:item.get_parent().height,style:item.style_class,
                            color:{red:color.red,green:color.green,blue:color.blue,alpha:color.alpha}});
                    }
                }
                for (const child of item.get_children()) walk(child);
            };
            walk(actor);
            const report = {x,y,width:actor.width,height:actor.height,stageHeight:global.stage.height,
                bars:bars.map(bar=>({...bar})),text:[...text]};
            const pause = milliseconds => new Promise(resolve => GLib.timeout_add(GLib.PRIORITY_DEFAULT,milliseconds,()=>{resolve();return GLib.SOURCE_REMOVE;}));
            extension.indicator.button.menu.close();
            await pause(400);
            extension.views.codex.snapshot.windows[0].usedPercent = 0;
            extension.views.codex.snapshot.windows[1].usedPercent = 38;
            extension.render();
            await pause(100);
            extension.indicator.button.menu.open();
            await pause(600);
            bars.length = 0; text.length = 0;
            walk(actor);
            report.reopened = bars.map(bar => ({...bar}));
            const settings = extension.indicator.button.menu._getMenuItems().find(item=>item.label?.text==='설정');
            settings.menu.open();
            await pause(300);
            text.length=0;bars.length=0;walk(actor);
            const [settingsX,settingsY]=actor.get_transformed_position();
            report.settings={text:[...text],height:actor.height,y:settingsY,width:actor.width,
                pollSeconds:extension.settings.get_int('poll-seconds')};
            report.settings.controls=[];
            const controls=item=>{
                if(item.mapped&&typeof item.get_text==='function'&&['Refresh','CLI 연결 및 설정','조회 간격'].includes(item.get_text())){
                    const [,controlY]=item.get_transformed_position();
                    if(!report.settings.controls.some(control=>control.text===item.get_text()))
                        report.settings.controls.push({text:item.get_text(),y:controlY,height:item.height});
                }
                for(const child of item.get_children())controls(child);
            };
            controls(actor);
            const settingsCapture=GLib.getenv('USAGESCOPE_UI_SETTINGS_CAPTURE');
            if(settingsCapture)await new Promise(resolve=>{
                const screenshot=new Shell.Screenshot();
                const output=Gio.File.new_for_path(settingsCapture).replace(null,false,Gio.FileCreateFlags.PRIVATE,null);
                screenshot.screenshot_area(Math.floor(settingsX),Math.floor(settingsY),Math.ceil(actor.width),Math.ceil(actor.height),output,(_object,result)=>{
                    try{screenshot.screenshot_area_finish(result);}finally{output.close(null);resolve();}
                });
            });
            const connection=settings.menu._getMenuItems().find(item=>item.label?.text==='CLI 연결 및 설정');
            connection.menu.open();
            const passive=connection.menu._getMenuItems().find(item=>item.label?.text==='Claude 상태줄 연결');
            passive.menu.open();
            const copy=passive.menu._getMenuItems().find(item=>item.label?.text==='Claude 미리보기 명령 복사');
            copy.emit('activate',null);
            const copied=await new Promise(resolve=>St.Clipboard.get_default().get_text(St.ClipboardType.CLIPBOARD,(_clipboard,value)=>resolve(value)));
            report.copyPreviewCorrect=typeof copied==='string'&&copied.startsWith('gjs -m ')&&copied.includes(extension.path+'/claude/setup.js')&&copied.endsWith(' --preview');
            passive.menu.close();connection.menu.close();
            extension.indicator.button.menu.open();settings.menu.open();
            const mode=settings.menu._getMenuItems().find(item=>item.label?.text==='Claude CLI 조회 (실험)');
            mode.emit('toggled',true);
            for(let i=0;i<100&&!(extension.views.claude.status==='ready'&&extension.views.claude.snapshot?.planType==='team');i++)await pause(50);
            report.cli={status:extension.views.claude.status,plan:extension.views.claude.snapshot?.planType,
                windows:extension.views.claude.snapshot?.windows.length,
                independentSource:extension.views.claude.snapshot?.sourceId.startsWith('claude-cli-')};
            settings.menu.close();await pause(300);
            bars.length=0;text.length=0;walk(actor);report.cli.bars=bars.map(bar=>({...bar}));
            const save = () => Gio.File.new_for_path(reportPath).replace_contents(
                new TextEncoder().encode(JSON.stringify(report)),null,false,Gio.FileCreateFlags.PRIVATE,null);
            if (capturePath) {
                const screenshot = new Shell.Screenshot();
                const output = Gio.File.new_for_path(capturePath).replace(null,false,Gio.FileCreateFlags.PRIVATE,null);
                const [captureX,captureY]=actor.get_transformed_position();
                screenshot.screenshot_area(Math.floor(captureX),Math.floor(captureY),Math.ceil(actor.width),Math.ceil(actor.height),output,(_object,result)=>{
                    try { screenshot.screenshot_area_finish(result); report.capture=true; }
                    catch { report.capture=false; }
                    finally { output.close(null); save(); }
                });
            } else save();
          })().catch(error=>logError(error));
            return GLib.SOURCE_REMOVE;
        });
        return GLib.SOURCE_REMOVE;
    });
};
