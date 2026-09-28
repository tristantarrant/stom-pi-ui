// SPDX-FileCopyrightText: 2026 MOD Audio UG
// SPDX-License-Identifier: AGPL-3.0-or-later
(function () {

    var state = { path: '', selection: {} }
    var $status, $tbody, $breadcrumbs, $btnDelete

    function relPath(name) {
        return state.path ? state.path + '/' + name : name
    }

    function fmtSize(bytes) {
        if (bytes < 1024) return bytes + ' B'
        var units = ['KB', 'MB', 'GB']
        var i = -1, v = bytes
        do { v /= 1024; i++ } while (v >= 1024 && i < units.length - 1)
        return v.toFixed(v >= 10 ? 0 : 1) + ' ' + units[i]
    }

    function fmtDate(ts) {
        var d = new Date(ts * 1000)
        function pad(n) { return n < 10 ? '0' + n : '' + n }
        return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) +
            ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes())
    }

    function setStatus(msg, isError) {
        $status.text(msg).toggleClass('error', !!isError)
    }

    function renderBreadcrumbs() {
        $breadcrumbs.empty()
        var root = $('<a href="#">User Files</a>')
        root.click(function () { navigateTo('') })
        $breadcrumbs.append(root)
        if (!state.path) return
        $.each(state.path.split('/'), function (i, seg) {
            $breadcrumbs.append($('<span>/</span>'))
            var link = $('<a href="#">' + seg + '</a>')
            var target = state.path.split('/').slice(0, i + 1).join('/')
            link.click(function () { navigateTo(target) })
            $breadcrumbs.append(link)
        })
    }

    function load() {
        $.ajax({
            url: '/file-manager/list',
            data: { path: state.path },
            dataType: 'json'
        }).done(function (resp) {
            renderBreadcrumbs()
            $tbody.empty()
            var count = 0
            $.each(resp.entries, function (i, entry) {
                count++
                var row = $('<tr>')
                    .attr('data-name', entry.name)
                    .css('cursor', entry.is_dir ? 'pointer' : 'default')

                var $check = $('<input type="checkbox">').change(function () {
                    if ($(this).is(':checked')) state.selection[entry.name] = true
                    else delete state.selection[entry.name]
                    updateDeleteButton()
                })
                row.append($('<td>').append($check))

                var $name = $('<span>')
                    .text(entry.is_dir ? entry.name + '/' : entry.name)
                    .css('font-weight', entry.is_dir ? 'bold' : 'normal')
                if (entry.is_dir) {
                    $name.addClass('dir').click(function () { navigateTo(relPath(entry.name)) })
                }
                row.append($('<td>').append($name))

                var $size = $('<td>')
                if (!entry.is_dir) {
                    $size.text(fmtSize(entry.size)).attr('title', entry.size + ' bytes')
                }
                row.append($size)

                row.append($('<td>').text(fmtDate(entry.mtime)))
                $tbody.append(row)
            })
            if (count === 0) {
                var empty = $('<tr class="empty"><td colspan="4">Empty folder</td></tr>')
                $tbody.append(empty)
            }
        }).fail(function (xhr, textStatus, error) {
            setStatus('Could not list files: ' + (error || textStatus), true)
        })
    }

    function navigateTo(path) {
        state.path = path.replace(/^\/+|\/+$/g, '')
        clearSelection()
        load()
    }

    function updateDeleteButton() {
        var n = 0
        for (var k in state.selection) if (state.selection.hasOwnProperty(k)) n++
        var icon = '\uD83D\uDDD1\uFE0F '
        $btnDelete.prop('disabled', n === 0).text(n ? icon + 'Delete selected (' + n + ')' : icon + 'Delete selected')
    }

    function clearSelection() {
        state.selection = {}
        updateDeleteButton()
        $('input[type=checkbox]', $tbody).prop('checked', false)
    }

    function xhrUpload(file, onDone, onError) {
        var fd = new FormData()
        fd.append('path', state.path)
        fd.append('files', file)
        var x = new XMLHttpRequest()
        x.open('POST', '/file-manager/upload')
        x.onload = function () {
            if (x.status >= 200 && x.status < 300) onDone(x.responseText)
            else onError((x.responseText || 'HTTP ' + x.status))
        }
        x.onerror = function () { onError('network error') }
        x.send(fd)
    }

    function uploadFiles(fileList, index, doneCount) {
        if (index >= fileList.length) {
            setStatus(doneCount + ' file(s) uploaded')
            load()
            return
        }
        var f = fileList[index]
        setStatus('Uploading (' + (doneCount + 1) + '/' + fileList.length + ') ' + f.name, false)
        xhrUpload(f,
            function () { uploadFiles(fileList, index + 1, doneCount + 1) },
            function (err) {
                setStatus('Upload failed for ' + f.name + ': ' + err, true)
                load()
            })
    }

    function startUpload(fileList) {
        if (!fileList || fileList.length === 0) return
        uploadFiles(fileList, 0, 0)
    }

    $(function () {
        $status = $('#fm-status-bar')
        $tbody = $('#fm-entries tbody')
        $breadcrumbs = $('#fm-breadcrumbs')
        $btnDelete = $('#fm-btn-delete')

        load()

        // Hidden file input (multi-select); the "Upload Files" <label for="..."> opens it natively
        var $input = $('#fm-file-input').change(function () {
            var files = Array.prototype.slice.call(this.files, 0)  // snapshot; clearing below may invalidate the FileList
            startUpload(files)
            $(this).val('')  // allow re-uploading the same selection
        })

        // New folder (prompt dialog; name sanitized server-side anyway)
        $('#fm-btn-new-folder').click(function () {
            var name = window.prompt('New folder name:')
            if (!name || !$.trim(name)) return
            $.post('/file-manager/mkdir', { path: state.path, name: name })
                .done(function (resp) {
                    setStatus(resp.ok ? "Folder '" + resp.name + "' created" : (resp.error || 'mkdir failed'), !resp.ok)
                    load()
                }).fail(function (xhr, textStatus, error) {
                    setStatus('Could not create folder: ' + (error || textStatus), true)
                })
        })

        // Delete selected entries one by one
        $btnDelete.click(function () {
            var names = []
            for (var k in state.selection) if (state.selection.hasOwnProperty(k)) names.push(k)
            if (!names.length) return
            var msg = 'Delete the following from user-files?\n\n' + names.join('\n') +
                '\n\nThis cannot be undone.'
            if (!window.confirm(msg)) return

            function delNext(i) {
                if (i >= names.length) { setStatus(names.length + " item(s) deleted"); clearSelection(); load(); return }
                $.post('/file-manager/delete', { path: relPath(names[i]) })
                    .done(function () { delNext(i + 1) })
                    .fail(function (xhr, textStatus, error) {
                        setStatus('Delete failed for ' + names[i] + ': ' + (error || textStatus), true)
                        clearSelection(); load()
                    })
            }
            delNext(0)
        })

        // Drag & drop upload onto the listing area. Plain DOM handlers so we do not
        // rely on jQuery's older drag/drop event plumbing for dataTransfer access.
        var $dropzone = $('#fm-dropzone')
        function hasFiles(e) { return e.dataTransfer && $.inArray('Files', e.dataTransfer.types) !== -1 }
        $dropzone[0].addEventListener('dragover', function (e) {
            if (!hasFiles(e)) return
            e.preventDefault()
            $dropzone.addClass('dropping')
        })
        $dropzone[0].addEventListener('dragleave', function () {
            $dropzone.removeClass('dropping')
        })
        $dropzone[0].addEventListener('drop', function (e) {
            if (!hasFiles(e)) return
            e.preventDefault()
            $dropzone.removeClass('dropping')
            var files = Array.prototype.slice.call(e.dataTransfer.files, 0)  // snapshot; dataTransfer goes stale after the event
            startUpload(files)
        })

        // Enter key on a folder row navigates into it (rows are focusable via tab index)
    })

})()
