Add-Type -AssemblyName System.Drawing
$ErrorActionPreference = 'Stop'

$iconsDir = Join-Path $PSScriptRoot 'icons'
New-Item -ItemType Directory -Force -Path $iconsDir | Out-Null

function New-RoundedPath([System.Drawing.Rectangle]$rect, [int]$radius) {
    $p = New-Object System.Drawing.Drawing2D.GraphicsPath
    $d = $radius * 2
    $p.AddArc($rect.X, $rect.Y, $d, $d, 180, 90)
    $p.AddArc($rect.Right - $d, $rect.Y, $d, $d, 270, 90)
    $p.AddArc($rect.Right - $d, $rect.Bottom - $d, $d, $d, 0, 90)
    $p.AddArc($rect.X, $rect.Bottom - $d, $d, $d, 90, 90)
    $p.CloseFigure()
    return $p
}

function New-Icon([int]$size, [string]$path) {
    $bmp = New-Object System.Drawing.Bitmap $size, $size
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = 'AntiAlias'
    $g.InterpolationMode = 'HighQualityBicubic'
    $g.PixelOffsetMode = 'HighQuality'
    $g.TextRenderingHint = 'AntiAliasGridFit'
    $g.Clear([System.Drawing.Color]::Transparent)

    $radius = [Math]::Max(2, [int]($size * 0.22))
    $rect = New-Object System.Drawing.Rectangle 0, 0, ($size - 1), ($size - 1)
    $rounded = New-RoundedPath $rect $radius

    # 多色对角渐变 (紫 -> 粉 -> 蓝青) Stripe 风
    $fillRect = New-Object System.Drawing.Rectangle 0, 0, $size, $size
    $cA = [System.Drawing.Color]::FromArgb(255, 124, 58, 237)
    $cB = [System.Drawing.Color]::FromArgb(255, 236, 72, 153)
    $cC = [System.Drawing.Color]::FromArgb(255, 59, 130, 246)
    $cD = [System.Drawing.Color]::FromArgb(255, 14, 165, 233)
    $brush = New-Object System.Drawing.Drawing2D.LinearGradientBrush $fillRect, $cA, $cD, 135.0
    $blend = New-Object System.Drawing.Drawing2D.ColorBlend 4
    $blend.Colors = @($cA, $cB, $cC, $cD)
    $blend.Positions = @(0.0, 0.4, 0.75, 1.0)
    $brush.InterpolationColors = $blend
    $g.FillPath($brush, $rounded)

    # 径向高光（左上柔和光斑）
    $glowRadius = [int]($size * 0.85)
    $gcx = [int]($size * 0.25)
    $gcy = [int]($size * 0.2)
    $glowRect = New-Object System.Drawing.Rectangle ($gcx - $glowRadius), ($gcy - $glowRadius), ($glowRadius * 2), ($glowRadius * 2)
    $glowPath = New-Object System.Drawing.Drawing2D.GraphicsPath
    $glowPath.AddEllipse($glowRect)
    $glowBrush = New-Object System.Drawing.Drawing2D.PathGradientBrush $glowPath
    $glowBrush.CenterPoint = (New-Object System.Drawing.PointF $gcx, $gcy)
    $glowBrush.CenterColor = [System.Drawing.Color]::FromArgb(85, 255, 255, 255)
    $glowBrush.SurroundColors = @([System.Drawing.Color]::FromArgb(0, 255, 255, 255))
    $g.SetClip($rounded)
    $g.FillPath($glowBrush, $glowPath)
    $g.ResetClip()

    # 顶部柔光带
    $hlH = [int]($size * 0.45)
    if ($hlH -gt 0) {
        $hlRect = New-Object System.Drawing.Rectangle 0, 0, $size, $hlH
        $hlBrush = New-Object System.Drawing.Drawing2D.LinearGradientBrush $hlRect, ([System.Drawing.Color]::FromArgb(55, 255, 255, 255)), ([System.Drawing.Color]::FromArgb(0, 255, 255, 255)), 90.0
        $g.SetClip($rounded)
        $g.FillRectangle($hlBrush, $hlRect)
        $g.ResetClip()
        $hlBrush.Dispose()
    }

    # J 字母（带柔和阴影 + 渐变填充 + 内描边）
    $fontSize = [Math]::Max(8.0, [double]($size * 0.66))
    $font = New-Object System.Drawing.Font 'Segoe UI', $fontSize, ([System.Drawing.FontStyle]::Bold), ([System.Drawing.GraphicsUnit]::Pixel)
    $sf = New-Object System.Drawing.StringFormat
    $sf.Alignment = 'Center'
    $sf.LineAlignment = 'Center'

    $textPath = New-Object System.Drawing.Drawing2D.GraphicsPath
    $textRect = New-Object System.Drawing.RectangleF 0, 0, $size, $size
    $textPath.AddString('J', $font.FontFamily, [int][System.Drawing.FontStyle]::Bold, $fontSize, $textRect, $sf)

    # 阴影
    $shadowOffset = [Math]::Max(1, [int]($size * 0.04))
    $shadowMatrix = New-Object System.Drawing.Drawing2D.Matrix
    $shadowMatrix.Translate($shadowOffset, $shadowOffset)
    $shadowPath = $textPath.Clone()
    $shadowPath.Transform($shadowMatrix)
    $shadowBrush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(160, 0, 0, 0))
    $g.FillPath($shadowBrush, $shadowPath)

    # 文字纯白
    $textBrush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::White)
    $g.FillPath($textBrush, $textPath)

    # 文字描边（细）
    if ($size -ge 32) {
        $strokePen = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(60, 255, 255, 255)), ([float]([Math]::Max(0.5, $size * 0.012)))
        $g.DrawPath($strokePen, $textPath)
        $strokePen.Dispose()
    }

    $bmp.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)

    $brush.Dispose()
    $glowBrush.Dispose()
    $shadowBrush.Dispose()
    $textBrush.Dispose()
    $shadowMatrix.Dispose()
    $shadowPath.Dispose()
    $textPath.Dispose()
    $font.Dispose()
    $sf.Dispose()
    $rounded.Dispose()
    $glowPath.Dispose()
    $g.Dispose()
    $bmp.Dispose()
}

foreach ($s in 16, 32, 48, 128) {
    $p = Join-Path $iconsDir "icon$s.png"
    New-Icon -size $s -path $p
    Write-Output "wrote $p"
}
