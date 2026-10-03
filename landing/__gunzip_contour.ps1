[IO.Compression.GZipStream]::new([IO.File]::OpenRead('landing\__contour.js.gz'),[IO.Compression.CompressionMode]::Decompress).CopyTo([IO.File]::Create('landing\order-contour-lab.js'))
